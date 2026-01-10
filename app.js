require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const express = require('express');
const passport = require('passport');
const session = require('express-session');
const Strategy = require('passport-discord').Strategy;
const axios = require('axios');
const SheetsDB = require('./database');

const client = new Client({
    intents: [3276799],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

SheetsDB.init();

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'xenory_express_pro_2026',
    resave: true,
    saveUninitialized: true,
    cookie: { secure: true, sameSite: 'none', maxAge: 86400000 }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));
passport.use(new Strategy({
    clientID: process.env.CLIENT_ID, clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL, scope: ['identify', 'guilds']
}, (at, rt, profile, done) => done(null, profile)));

// --- BOT LOGIC ---
client.on('guildMemberAdd', async (member) => {
    const config = await SheetsDB.getConfig(member.guild.id);
    if (config.autoRoleId) member.roles.add(config.autoRoleId).catch(() => {});
    if (config.welcomeChannelId) {
        const chan = member.guild.channels.cache.get(config.welcomeChannelId);
        if (chan) chan.send(config.welcomeMsg.replace('{user}', `<@${member.id}>`));
    }
    if (config.enableDm) member.send(config.welcomeDmMsg.replace('{user}', member.user.username)).catch(() => {});
});

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await SheetsDB.getConfig(int.guild.id);

    if (int.customId === 'xenory_verify') {
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        return int.reply({ content: "✅ Verificado!", ephemeral: true });
    }

    if (int.customId === 'xenory_start_form') {
        const chan = await int.guild.channels.create({
            name: `ficha-${int.user.username}`, type: ChannelType.GuildText, parent: config.formCategoryId || null,
            permissionOverwrites: [{ id: int.guild.id, deny: [8n] }, { id: int.user.id, allow: [1024n, 2048n, 32768n] }]
        });
        await chan.send({ content: `${int.user}`, embeds: [new EmbedBuilder().setTitle("📸 Envio de Mídia").setDescription("Mande foto/vídeo agora.").setColor("Purple")] });
        return int.reply({ content: "Canal criado!", ephemeral: true });
    }

    if (int.customId.startsWith('staff_app_') || int.customId.startsWith('staff_rej_')) {
        const [action, userId] = int.customId.split('_').slice(1, 3);
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) user.send(action === 'app' ? "✅ Sua ficha foi aprovada!" : "❌ Sua ficha foi recusada.").catch(() => {});
        await int.reply(action === 'app' ? "Aceito." : "Recusado.");
        return int.message.delete();
    }
});

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.name.startsWith('ficha-')) return;
    if (msg.attachments.size > 0) {
        const config = await SheetsDB.getConfig(msg.guild.id);
        const staff = msg.guild.channels.cache.get(config.formStaffChannelId);
        if (staff) {
            const file = msg.attachments.first();
            const embed = new EmbedBuilder().setTitle("📋 NOVA FICHA").addFields({name: "Candidato", value: msg.author.tag}).setColor("Orange");
            if (!file.contentType?.includes('video')) embed.setImage(file.url);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`staff_app_${msg.author.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`staff_rej_${msg.author.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
            );
            await staff.send({ content: config.staffRoleId ? `<@&${config.staffRoleId}>` : "", embeds: [embed], components: [row] });
            if (file.contentType?.includes('video')) await staff.send({ content: `🎥 Vídeo: ${file.url}` });
            await msg.channel.send("✅ Enviado!");
            setTimeout(() => msg.channel.delete(), 3000);
        }
    }
});

// Comandos
client.on('messageCreate', async (msg) => {
    if (!msg.content.startsWith('/') || msg.author.bot || !msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const config = await SheetsDB.getConfig(msg.guild.id);
    if (msg.content.toLowerCase() === '/form') {
        const e = new EmbedBuilder().setTitle(config.formTitle || "Recrutamento").setDescription("Clique abaixo.").setColor("Purple");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_start_form').setLabel('Iniciar').setStyle(ButtonStyle.Primary));
        msg.channel.send({ embeds: [e], components: [r] });
    }
    if (msg.content.toLowerCase() === '/verificar') {
        const e = new EmbedBuilder().setTitle("🛡️ Verificação").setDescription("Clique abaixo.").setColor("Blue");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_verify').setLabel('Verificar').setStyle(ButtonStyle.Success));
        msg.channel.send({ embeds: [e], components: [r] });
    }
});

// --- ROTAS SITE ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    req.session.save(() => res.redirect('/dashboard'));
});

app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    res.render('dashboard', { guilds: req.user.guilds.filter(g => (g.permissions & 0x8) === 0x8) });
});

app.get('/config/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const guild = await client.guilds.fetch(req.params.id).catch(() => null);
    const config = await SheetsDB.getConfig(req.params.id);
    res.render('config', { 
        guild, config, page: req.query.p || 'general',
        channels: guild.channels.cache, roles: guild.roles.cache,
        stats: { members: guild.memberCount, boosts: guild.premiumSubscriptionCount, channels: guild.channels.cache.size }
    });
});

app.post('/save/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    await SheetsDB.saveConfig(req.params.id, req.body);
    req.session.save(() => res.redirect(`/config/${req.params.id}?p=${req.body.last_page}`));
});

app.listen(process.env.PORT || 3000, () => {
    console.log("🚀 Xenory Pro On (Express)");
    setInterval(() => { axios.get(process.env.CALLBACK_URL.split('/auth')[0]).catch(() => {}); }, 600000);
});
client.login(process.env.TOKEN);
