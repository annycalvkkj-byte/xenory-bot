require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const Koa = require('koa');
const Router = require('koa-router');
const render = require('koa-ejs');
const bodyParser = require('koa-bodyparser');
const session = require('koa-session');
const passport = require('koa-passport');
const Strategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const GuildConfig = require('./database');
const axios = require('axios'); // Para o Auto-Ping

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ DB Xenory Conectado"));

const app = new Koa();
const router = new Router();

// CONFIGURAÇÃO RENDER
app.proxy = true; 
render(app, { root: __dirname, layout: false, viewExt: 'ejs', cache: false });

app.keys = ['xenory_render_2026'];
app.use(session({ key: 'koa.sess', maxAge: 86400000, renew: true }, app));
app.use(bodyParser());
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));
passport.use(new Strategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (at, rt, profile, done) => done(null, profile)));

// --- LÓGICA DO BOT (AUTO-ROLE E VERIFICAÇÃO) ---

// 1. ADICIONAR CARGO AO ENTRAR
client.on('guildMemberAdd', async (member) => {
    const config = await GuildConfig.findOne({ guildId: member.guild.id });
    if (config?.autoRoleId) {
        member.roles.add(config.autoRoleId).catch(() => console.log("Erro ao dar cargo inicial."));
    }
});

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await GuildConfig.findOne({ guildId: int.guild.id });

    // 2. VERIFICAÇÃO (GANHA UM, PERDE O OUTRO)
    if (int.customId === 'xenory_verify') {
        if (!config?.verifyRoleId) return int.reply({ content: "Configuração incompleta no site.", ephemeral: true });

        // Adiciona cargo de Verificado
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        
        // Remove cargo de Auto-Role (se ele tiver)
        if (config.autoRoleId && int.member.roles.cache.has(config.autoRoleId)) {
            await int.member.roles.remove(config.autoRoleId).catch(() => {});
        }

        return int.reply({ content: "✅ Você foi verificado! O cargo restrito foi removido.", ephemeral: true });
    }

    // Lógica de Recrutamento (Foto/Vídeo)
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
        await channel.send({ content: `${int.user}`, embeds: [new EmbedBuilder().setTitle("📸 Envio de Mídia").setDescription("Mande uma **FOTO ou VÍDEO** agora.").setColor("Purple")] });
        return int.reply({ content: `Canal aberto: ${channel}`, ephemeral: true });
    }
});

// Mensagens de Mídia (Fichas)
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.name.startsWith('ficha-')) return;
    if (msg.attachments.size > 0) {
        const config = await GuildConfig.findOne({ guildId: msg.guild.id });
        const staffChan = msg.guild.channels.cache.get(config?.formStaffChannelId);
        if (staffChan) {
            const file = msg.attachments.first();
            const e = new EmbedBuilder().setTitle("📋 NOVA FICHA").addFields({ name: "Candidato", value: `${msg.author.tag}` }).setColor("Orange");
            if (!file.contentType?.includes('video')) e.setImage(file.url);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`staff_app_${msg.author.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`staff_rej_${msg.author.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
            );
            await staffChan.send({ content: config.staffRoleId ? `<@&${config.staffRoleId}>` : "Nova ficha!", embeds: [e], components: [row] });
            if (file.contentType?.includes('video')) await staffChan.send({ content: `🎥 **VÍDEO:** ${file.url}` });
            await msg.channel.send("✅ Enviado! Fechando em 5 segundos.");
            setTimeout(() => msg.channel.delete().catch(() => {}), 5000);
        }
    }
});

// --- ROTAS WEB ---
router.get('/', async (ctx) => { await ctx.render('index'); });
router.get('/login', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), async (ctx) => {
    ctx.redirect('/dashboard');
});
router.get('/dashboard', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.redirect('/login');
    const guilds = ctx.state.user.guilds.filter(g => (g.permissions & 0x8) === 0x8);
    await ctx.render('dashboard', { guilds });
});
router.get('/config/:id', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.redirect('/login');
    const guild = await client.guilds.fetch(ctx.params.id).catch(() => null);
    if (!guild) return ctx.body = "Bot não encontrado.";
    const config = await GuildConfig.findOne({ guildId: ctx.params.id }) || { guildId: ctx.params.id };
    const channels = guild.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type }));
    const roles = guild.roles.cache.map(r => ({ id: r.id, name: r.name }));
    await ctx.render('config', { guild, config, channels, roles });
});
router.post('/save/:id', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.status = 401;
    await GuildConfig.findOneAndUpdate({ guildId: ctx.params.id }, ctx.request.body, { upsert: true });
    ctx.redirect('/dashboard');
});

app.use(router.routes()).use(router.allowedMethods());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Xenory On na porta ${PORT}`);
    
    // SISTEMA AUTO-PING (Mantém o Render acordado)
    setInterval(() => {
        const url = process.env.CALLBACK_URL.split('/auth')[0]; // Pega a URL base do seu site
        axios.get(url).then(() => console.log("⚡ Auto-Ping: Mantendo acordado!")).catch(() => {});
    }, 1000 * 60 * 10); // A cada 10 minutos
});

client.login(process.env.TOKEN);
