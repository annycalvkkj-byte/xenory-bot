require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType 
} = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const Strategy = require('passport-discord').Strategy;
const path = require('path');
const GuildConfig = require('./database');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ DB Xenory Conectado"));

const app = express();
app.set('trust proxy', 1); // CRÍTICO PARA RAILWAY
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'xenory_railway_stable_2026',
    resave: true,
    saveUninitialized: false,
    cookie: { secure: true, sameSite: 'lax', maxAge: 60000 * 60 * 24 }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new Strategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (at, rt, profile, done) => done(null, profile)));

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));

// --- BOT LOGIC ---

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await GuildConfig.findOne({ guildId: int.guild.id });

    // Iniciar Form
    if (int.customId === 'xenory_start_form') {
        const channel = await int.guild.channels.create({
            name: `ficha-${int.user.username}`,
            type: ChannelType.GuildText,
            parent: config?.formCategoryId || null,
            permissionOverwrites: [
                { id: int.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: int.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
            ]
        });
        await channel.send({ content: `${int.user}`, embeds: [new EmbedBuilder().setTitle("📸 Mídia Requerida").setDescription("Envie agora uma **FOTO ou VÍDEO** neste canal.").setColor("Purple")] });
        return int.reply({ content: `Canal criado: ${channel}`, ephemeral: true });
    }

    // Staff Buttons
    if (int.customId.startsWith('staff_app_') || int.customId.startsWith('staff_rej_')) {
        const [action, userId] = int.customId.split('_').slice(1, 3);
        const user = await client.users.fetch(userId).catch(() => null);
        if (action === 'app') {
            if (user) user.send(`✅ Sua ficha em **${int.guild.name}** foi aceita!`).catch(() => {});
            await int.reply(`Aprovado: <@${userId}>`);
        } else {
            if (user) user.send(`❌ Sua ficha em **${int.guild.name}** foi recusada.`).catch(() => {});
            await int.reply(`Recusado: <@${userId}>`);
        }
        return int.message.delete().catch(() => {});
    }

    // Modal Edit Form
    if (int.isModalSubmit() && int.customId === 'modal_edit_form') {
        const title = int.fields.getTextInputValue('title_input');
        await GuildConfig.findOneAndUpdate({ guildId: int.guild.id }, { formTitle: title }, { upsert: true });
        return int.reply({ content: "✅ Título atualizado!", ephemeral: true });
    }
});

// Capturar Mídia
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.name.startsWith('ficha-')) return;
    if (msg.attachments.size > 0) {
        const config = await GuildConfig.findOne({ guildId: msg.guild.id });
        const staffChan = msg.guild.channels.cache.get(config?.formStaffChannelId);
        if (staffChan) {
            const file = msg.attachments.first();
            const embed = new EmbedBuilder().setTitle("📋 NOVA FICHA").addFields({name:"Candidato", value:msg.author.tag}).setColor("Orange");
            if (!file.contentType?.includes('video')) embed.setImage(file.url);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`staff_app_${msg.author.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`staff_rej_${msg.author.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
            );
            await staffChan.send({ content: config.staffRoleId ? `<@&${config.staffRoleId}>` : "Nova ficha!", embeds: [embed], components: [row] });
            if (file.contentType?.includes('video')) await staffChan.send({ content: `🎥 Vídeo: ${file.url}` });
            await msg.channel.send("✅ Enviado para Staff! Deletando em 5 segundos...");
            setTimeout(() => msg.channel.delete().catch(() => {}), 5000);
        }
    }
});

// Comandos de Barra Manual (Mensagem)
client.on('messageCreate', async (msg) => {
    if (!msg.content.startsWith('/') || msg.author.bot || !msg.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const cmd = msg.content.toLowerCase();
    if (cmd === '/form') {
        const config = await GuildConfig.findOne({ guildId: msg.guild.id });
        const e = new EmbedBuilder().setTitle(config?.formTitle || "Recrutamento").setDescription("Clique para iniciar.").setColor("Purple");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_start_form').setLabel('Iniciar').setStyle(ButtonStyle.Primary));
        msg.channel.send({ embeds: [e], components: [r] });
    }
    if (cmd === '/editform') {
        const modal = new ModalBuilder().setCustomId('modal_edit_form').setTitle('Editar Form');
        const input = new TextInputBuilder().setCustomId('title_input').setLabel('Título').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        // Como modal precisa de interação, enviamos um botão para abrir
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_modal_btn').setLabel('Abrir Editor').setStyle(ButtonStyle.Secondary));
        msg.reply({ content: "Clique para editar:", components: [r] });
    }
});

client.on('interactionCreate', async (int) => {
    if (int.customId === 'open_modal_btn') {
        const modal = new ModalBuilder().setCustomId('modal_edit_form').setTitle('Editar Form');
        const input = new TextInputBuilder().setCustomId('title_input').setLabel('Título').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await int.showModal(modal);
    }
});

// --- ROUTES ---

app.get('/', (req, res) => res.render('index'));
app.get('/login', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    req.session.save(() => res.redirect('/dashboard'));
});
app.get('/dashboard', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const guilds = req.user.guilds.filter(g => (g.permissions & 0x8) === 0x8);
    res.render('dashboard', { guilds });
});
app.get('/config/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const guild = await client.guilds.fetch(req.params.id).catch(() => null);
    if (!guild) return res.send("Bot fora do servidor.");
    const config = await GuildConfig.findOne({ guildId: req.params.id }) || { guildId: req.params.id };
    const channels = guild.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type }));
    const roles = guild.roles.cache.map(r => ({ id: r.id, name: r.name }));
    res.render('config', { guild, config, channels, roles });
});
app.post('/save/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    await GuildConfig.findOneAndUpdate({ guildId: req.params.id }, req.body, { upsert: true });
    req.session.save(() => res.redirect('/dashboard'));
});

app.listen(process.env.PORT || 3000);
client.login(process.env.TOKEN);
