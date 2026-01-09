require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const Strategy = require('passport-discord').Strategy;
const axios = require('axios');
const GuildConfig = require('./database');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ DB Xenory Conectado"));

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({ 
    secret: 'xenory_ultra_pro_2026', 
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

// --- LÓGICA DE BOAS-VINDAS ---
client.on('guildMemberAdd', async (member) => {
    const config = await GuildConfig.findOne({ guildId: member.guild.id });
    if (!config) return;

    // Auto-role
    if (config.autoRoleId) member.roles.add(config.autoRoleId).catch(() => {});

    // Msg no Canal
    if (config.welcomeChannelId) {
        const chan = member.guild.channels.cache.get(config.welcomeChannelId);
        if (chan) chan.send(config.welcomeMsg.replace('{user}', `<@${member.id}>`)).catch(() => {});
    }

    // Msg na DM
    if (config.enableDm && config.welcomeDmMsg) {
        member.send(config.welcomeDmMsg.replace('{user}', member.user.username)).catch(() => {});
    }
});

// --- LÓGICA DE VERIFICAÇÃO E FICHA (MANTIDA) ---
client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await GuildConfig.findOne({ guildId: int.guild.id });
    if (int.customId === 'xenory_verify') {
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        return int.reply({ content: "✅ Verificado!", ephemeral: true });
    }
    // ... (Logica de recrutamento start_form e staff_app/rej igual ao anterior)
});

// --- ROTAS DO SITE ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    req.session.save(() => res.redirect('/dashboard'));
});

app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const guilds = req.user.guilds.filter(g => (g.permissions & 0x8) === 0x8);
    res.render('dashboard', { guilds });
});

// ROTA DE CONFIGURAÇÃO (Agora com abas/sidebar)
app.get('/config/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const guild = await client.guilds.fetch(req.params.id).catch(() => null);
    if (!guild) return res.send("Bot fora do servidor.");
    const config = await GuildConfig.findOne({ guildId: req.params.id }) || { guildId: req.params.id };
    
    // Pegar dados do servidor para a aba "Estatísticas"
    const stats = {
        members: guild.memberCount,
        boosts: guild.premiumSubscriptionCount,
        channels: guild.channels.cache.size
    };

    res.render('config', { 
        guild, config, stats,
        channels: guild.channels.cache, 
        roles: guild.roles.cache,
        page: req.query.p || 'general' // Controla qual aba mostrar
    });
});

app.post('/save/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    await GuildConfig.findOneAndUpdate({ guildId: req.params.id }, req.body, { upsert: true });
    req.session.save(() => res.redirect(`/config/${req.params.id}?p=${req.body.last_page || 'general'}`));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Xenory Pro On: ${PORT}`));
client.login(process.env.TOKEN);
