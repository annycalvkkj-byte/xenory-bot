require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const Koa = require('koa');
const Router = require('koa-router');
const render = require('koa-ejs');
const bodyParser = require('koa-bodyparser');
const mongoose = require('mongoose');
const passport = require('koa-passport');
const Strategy = require('passport-discord').Strategy;
const GuildConfig = require('./database');
const axios = require('axios');

// Correção para carregamento do Koa-Session
let session = require('koa-session');
if (typeof session !== 'function') session = session.default;

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ MongoDB Conectado"));

const app = new Koa();
const router = new Router();
app.proxy = true; 

render(app, { root: __dirname, layout: false, viewExt: 'ejs', cache: false });
app.keys = ['xenory_render_stable_2026'];
app.use(session({ key: 'koa.sess', maxAge: 86400000, renew: true }, app));
app.use(bodyParser());
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));
passport.use(new Strategy({
    clientID: process.env.CLIENT_ID, clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL, scope: ['identify', 'guilds']
}, (at, rt, profile, done) => done(null, profile)));

// --- BOT: AUTO-ROLE AO ENTRAR ---
client.on('guildMemberAdd', async (member) => {
    const config = await GuildConfig.findOne({ guildId: member.guild.id });
    if (config?.autoRoleId) member.roles.add(config.autoRoleId).catch(() => {});
});

// --- BOT: INTERAÇÕES ---
client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await GuildConfig.findOne({ guildId: int.guild.id });

    // VERIFICAÇÃO: Dá cargo novo e REMOVE o de entrada
    if (int.customId === 'xenory_verify') {
        if (!config?.verifyRoleId) return int.reply({ content: "Erro na config.", ephemeral: true });
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        return int.reply({ content: "✅ Verificado com sucesso!", ephemeral: true });
    }

    // INICIAR RECRUTAMENTO
    if (int.customId === 'xenory_start_form') {
        const chan = await int.guild.channels.create({
            name: `ficha-${int.user.username}`, type: ChannelType.GuildText, parent: config?.formCategoryId || null,
            permissionOverwrites: [
                { id: int.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: int.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
            ]
        });
        await chan.send({ content: `${int.user}`, embeds: [new EmbedBuilder().setTitle("📸 Envie sua Mídia").setDescription("Envie uma **FOTO ou VÍDEO** para avaliação.").setColor("Purple")] });
        return int.reply({ content: `Canal criado: ${chan}`, ephemeral: true });
    }

    // ACEITAR/RECUSAR STAFF
    if (int.customId.startsWith('staff_app_') || int.customId.startsWith('staff_rej_')) {
        const action = int.customId.split('_')[1];
        const userId = int.customId.split('_')[2];
        const user = await client.users.fetch(userId).catch(() => null);
        if (action === 'app') {
            if (user) user.send("✅ Sua ficha foi aprovada!").catch(() => {});
            await int.reply("Aprovado.");
        } else {
            if (user) user.send("❌ Sua ficha foi recusada.").catch(() => {});
            await int.reply("Recusado.");
        }
        return int.message.delete().catch(() => {});
    }
});

// RECEBER FOTO/VÍDEO
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.name.startsWith('ficha-')) return;
    if (msg.attachments.size > 0) {
        const config = await GuildConfig.findOne({ guildId: msg.guild.id });
        const staffChan = msg.guild.channels.cache.get(config?.formStaffChannelId);
        if (staffChan) {
            const file = msg.attachments.first();
            const isVideo = file.contentType?.includes('video');
            const e = new EmbedBuilder().setTitle("📋 FICHA RECEBIDA").addFields({ name: "Candidato", value: msg.author.tag }).setColor("Orange");
            if (!isVideo) e.setImage(file.url);
            const r = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`staff_app_${msg.author.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`staff_rej_${msg.author.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
            );
            await staffChan.send({ content: config.staffRoleId ? `<@&${config.staffRoleId}>` : "Nova ficha!", embeds: [e], components: [r] });
            if (isVideo) await staffChan.send({ content: `🎥 Vídeo: ${file.url}` });
            await msg.channel.send("✅ Enviado! Canal fechando...");
            setTimeout(() => msg.channel.delete().catch(() => {}), 4000);
        }
    }
});

// COMANDOS /FORM E /VERIFICAR
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    if (msg.content.toLowerCase() === '/form') {
        const config = await GuildConfig.findOne({ guildId: msg.guild.id });
        msg.channel.send({ 
            embeds: [new EmbedBuilder().setTitle(config?.formTitle || "Recrutamento").setColor("Purple")],
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_start_form').setLabel('Iniciar').setStyle(ButtonStyle.Primary))]
        });
    }
    if (msg.content.toLowerCase() === '/verificar') {
        msg.channel.send({ 
            embeds: [new EmbedBuilder().setTitle("🛡️ Verificação").setColor("Blue")],
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_verify').setLabel('Verificar').setStyle(ButtonStyle.Success))]
        });
    }
});

// --- ROTAS SITE ---
router.get('/', async (ctx) => { await ctx.render('index'); });
router.get('/login', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), async (ctx) => { ctx.redirect('/dashboard'); });
router.get('/dashboard', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.redirect('/login');
    const guilds = ctx.state.user.guilds.filter(g => (g.permissions & 0x8) === 0x8);
    await ctx.render('dashboard', { guilds });
});
router.get('/config/:id', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.redirect('/login');
    const guild = await client.guilds.fetch(ctx.params.id).catch(() => null);
    const config = await GuildConfig.findOne({ guildId: ctx.params.id }) || { guildId: ctx.params.id };
    await ctx.render('config', { guild, config, channels: guild.channels.cache, roles: guild.roles.cache });
});
router.post('/save/:id', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.status = 401;
    await GuildConfig.findOneAndUpdate({ guildId: ctx.params.id }, ctx.request.body, { upsert: true });
    ctx.redirect('/dashboard');
});

app.use(router.routes()).use(router.allowedMethods());
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Xenory On: ${PORT}`);
    setInterval(() => {
        const url = process.env.CALLBACK_URL.split('/auth')[0];
        axios.get(url).catch(() => {});
    }, 600000); // 10 minutos
});
client.login(process.env.TOKEN);
