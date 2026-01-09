require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const Strategy = require('passport-discord').Strategy;
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
    secret: 'hexory_labs_2026_pro', 
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

// --- LÓGICA DE BOAS-VINDAS E AUTO-ROLE ---
client.on('guildMemberAdd', async (member) => {
    const config = await GuildConfig.findOne({ guildId: member.guild.id });
    if (!config) return;

    if (config.autoRoleId) member.roles.add(config.autoRoleId).catch(() => {});

    if (config.welcomeChannelId) {
        const chan = member.guild.channels.cache.get(config.welcomeChannelId);
        if (chan) chan.send(config.welcomeMsg.replace('{user}', `<@${member.id}>`)).catch(() => {});
    }

    if (config.enableDm && config.welcomeDmMsg) {
        member.send(config.welcomeDmMsg.replace('{user}', member.user.username)).catch(() => {});
    }
});

// --- LÓGICA DE RECRUTAMENTO E VERIFICAÇÃO ---
client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await GuildConfig.findOne({ guildId: int.guild.id });

    if (int.customId === 'xenory_verify') {
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        return int.reply({ content: "✅ Verificado com sucesso!", ephemeral: true });
    }

    if (int.customId === 'xenory_start_form') {
        if (!config?.formStaffChannelId) return int.reply({ content: "❌ Recrutamento não configurado no site!", ephemeral: true });
        
        const channel = await int.guild.channels.create({
            name: `ficha-${int.user.username}`,
            type: ChannelType.GuildText,
            parent: config.formCategoryId || null,
            permissionOverwrites: [
                { id: int.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: int.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
            ]
        });
        await channel.send({ content: `${int.user}`, embeds: [new EmbedBuilder().setTitle("📸 Envio de Mídia").setDescription("Mande uma **FOTO ou VÍDEO** agora para ser avaliado pela Staff.").setColor("Purple")] });
        return int.reply({ content: `✅ Canal aberto: ${channel}`, ephemeral: true });
    }

    if (int.customId.startsWith('staff_app_') || int.customId.startsWith('staff_rej_')) {
        const [action, userId] = int.customId.split('_').slice(1, 3);
        const user = await client.users.fetch(userId).catch(() => null);
        if (action === 'app') {
            if (user) user.send(`✅ Sua ficha em **${int.guild.name}** foi aprovada!`).catch(() => {});
            await int.reply(`Aprovado: <@${userId}>`);
        } else {
            if (user) user.send(`❌ Sua ficha em **${int.guild.name}** foi recusada.`).catch(() => {});
            await int.reply(`Recusado: <@${userId}>`);
        }
        return int.message.delete().catch(() => {});
    }
});

// Receber Mídia do Recrutamento
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.name.startsWith('ficha-')) return;
    if (msg.attachments.size > 0) {
        const config = await GuildConfig.findOne({ guildId: msg.guild.id });
        const staffChan = msg.guild.channels.cache.get(config?.formStaffChannelId);
        if (staffChan) {
            const file = msg.attachments.first();
            const isVideo = file.contentType?.includes('video');
            const e = new EmbedBuilder().setTitle("📋 NOVA FICHA").addFields({name:"Candidato", value:msg.author.tag}).setColor("Orange");
            if (!isVideo) e.setImage(file.url);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`staff_app_${msg.author.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`staff_rej_${msg.author.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
            );
            await staffChan.send({ content: config.staffRoleId ? `<@&${config.staffRoleId}>` : "Nova ficha!", embeds: [e], components: [row] });
            if (isVideo) await staffChan.send({ content: `🎥 Vídeo: ${file.url}` });
            await msg.channel.send("✅ Enviado! Canal fechando...");
            setTimeout(() => msg.channel.delete().catch(() => {}), 3000);
        }
    }
});

// Comandos
client.on('messageCreate', async (msg) => {
    if (!msg.content.startsWith('/') || msg.author.bot || !msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const config = await GuildConfig.findOne({ guildId: msg.guild.id });
    if (msg.content.toLowerCase() === '/form') {
        const e = new EmbedBuilder().setTitle(config?.formTitle || "Recrutamento").setDescription("Clique abaixo para iniciar sua ficha.").setColor("Purple");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_start_form').setLabel('Iniciar').setStyle(ButtonStyle.Primary));
        msg.channel.send({ embeds: [e], components: [r] });
    }
    if (msg.content.toLowerCase() === '/verificar') {
        const e = new EmbedBuilder().setTitle("🛡️ Verificação").setDescription("Clique para verificar.").setColor("Blue");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_verify').setLabel('Verificar').setStyle(ButtonStyle.Success));
        msg.channel.send({ embeds: [e], components: [r] });
    }
});

// --- ROTAS WEB ---
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
    const config = await GuildConfig.findOne({ guildId: req.params.id }) || { guildId: req.params.id };
    
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
    await GuildConfig.findOneAndUpdate({ guildId: req.params.id }, req.body, { upsert: true });
    req.session.save(() => res.redirect(`/config/${req.params.id}?p=${req.body.last_page}`));
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 Xenory Pro On"));
client.login(process.env.TOKEN);
