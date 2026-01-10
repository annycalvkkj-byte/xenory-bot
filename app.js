require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const express = require('express');
const passport = require('passport');
const session = require('express-session');
const Strategy = require('passport-discord').Strategy;
const axios = require('axios');
const SheetsDB = require('./database'); // Importa o novo banco

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

// Inicia o SheetsDB
SheetsDB.init().catch(console.error);

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({ 
    secret: 'xenory_sheets_pro_2026', 
    resave: false, saveUninitialized: false,
    cookie: { secure: true, sameSite: 'none', maxAge: 60000 * 60 * 24 } 
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new Strategy({
    clientID: process.env.CLIENT_ID, clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL, scope: ['identify', 'guilds']
}, (at, rt, profile, done) => done(null, profile)));

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));

// --- LÓGICA DO BOT ( SheetsDB ) ---

client.on('guildMemberAdd', async (member) => {
    const config = await SheetsDB.getConfig(member.guild.id);
    if (!config) return;
    if (config.autoRoleId) member.roles.add(config.autoRoleId).catch(() => {});
});

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await SheetsDB.getConfig(int.guild.id);

    if (int.customId === 'xenory_verify') {
        if (!config?.verifyRoleId) return int.reply({ content: "Erro de config.", ephemeral: true });
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        return int.reply({ content: "✅ Verificado!", ephemeral: true });
    }

    if (int.customId === 'xenory_start_form') {
        const chan = await int.guild.channels.create({
            name: `ficha-${int.user.username}`, type: ChannelType.GuildText, parent: config?.formCategoryId || null,
            permissionOverwrites: [
                { id: int.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: int.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
            ]
        });
        await chan.send({ content: `${int.user}`, embeds: [new EmbedBuilder().setTitle(config.formTitle).setDescription("Envie sua **FOTO ou VÍDEO**.").setColor("Purple")] });
        return int.reply({ content: `Canal criado: ${chan}`, ephemeral: true });
    }
});

// --- ROTAS DO SITE ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    req.session.save(() => res.redirect('/dashboard'));
});

app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const adminGuilds = req.user.guilds.filter(g => (g.permissions & 0x8) === 0x8);
    res.render('dashboard', { guilds: adminGuilds });
});

app.get('/config/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const guild = await client.guilds.fetch(req.params.id).catch(() => null);
    if (!guild) return res.send("Bot fora do servidor.");
    
    // Busca config na planilha
    const config = await SheetsDB.getConfig(req.params.id) || { guildId: req.params.id };
    const stats = { members: guild.memberCount, boosts: guild.premiumSubscriptionCount, channels: guild.channels.cache.size };

    res.render('config', { 
        guild, config, stats,
        channels: guild.channels.cache, 
        roles: guild.roles.cache,
        page: req.query.p || 'general' 
    });
});

app.post('/save/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const guildId = req.params.id;
    // Salva ou atualiza personalidade e configs na planilha
    await SheetsDB.saveConfig(guildId, req.body);
    req.session.save(() => res.redirect(`/config/${guildId}?p=${req.body.last_page}`));
});

// Rota de teste para salvar compra na planilha
app.get('/buy-test/:id', async (req, res) => {
    await SheetsDB.savePurchase({
        userId: req.params.id,
        email: "exemplo@gmail.com",
        item: "Xenory Pro",
        value: "R$ 23,00"
    });
    res.send("Compra salva no Google Sheets!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Xenory Pro (Sheets) On: ${PORT}`));
client.login(process.env.TOKEN);
