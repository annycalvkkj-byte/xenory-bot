try { require('dotenv').config(); } catch (e) {}
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const Koa = require('koa');
const Router = require('koa-router');
const render = require('koa-ejs');
const bodyParser = require('koa-bodyparser');
const passport = require('koa-passport');
const Strategy = require('passport-discord').Strategy;
const SheetsDB = require('./database');
const axios = require('axios');

// Correção para o módulo de sessão
let session = require('koa-session');
if (typeof session !== 'function' && session.default) {
    session = session.default;
}

const client = new Client({
    intents: [3276799], // Todos os Intents ativos
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

// Inicializa Planilha Google
SheetsDB.init();

const app = new Koa();
const router = new Router();

app.proxy = true;
app.keys = ['xenory_pro_sheets_2026'];

render(app, {
    root: __dirname,
    layout: false,
    viewExt: 'ejs',
    cache: false
});

app.use(session({
    key: 'koa.sess',
    maxAge: 86400000,
    renew: true,
    rolling: true
}, app));

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
}, (at, rt, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

// --- LÓGICA DO BOT (GOOGLE SHEETS) ---

client.on('guildMemberAdd', async (member) => {
    const config = await SheetsDB.getConfig(member.guild.id);
    if (!config) return;
    if (config.autoRoleId) member.roles.add(config.autoRoleId).catch(() => {});
    if (config.welcomeChannelId) {
        const chan = member.guild.channels.cache.get(config.welcomeChannelId);
        if (chan) chan.send(config.welcomeMsg.replace('{user}', `<@${member.id}>`)).catch(() => {});
    }
    if (config.enableDm) member.send(config.welcomeDmMsg.replace('{user}', member.user.username)).catch(() => {});
});

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await SheetsDB.getConfig(int.guild.id);

    if (int.customId === 'xenory_verify') {
        if (!config.verifyRoleId) return int.reply({ content: "Configuração incompleta.", ephemeral: true });
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        return int.reply({ content: "✅ Verificado!", ephemeral: true });
    }

    if (int.customId === 'xenory_start_form') {
        try {
            const chan = await int.guild.channels.create({
                name: `ficha-${int.user.username}`,
                type: ChannelType.GuildText,
                parent: config.formCategoryId || null,
                permissionOverwrites: [
                    { id: int.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: int.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
                ]
            });
            await chan.send({ content: `${int.user}`, embeds: [new EmbedBuilder().setTitle("📸 Recrutamento").setDescription("Envie uma **FOTO ou VÍDEO** agora.").setColor("Purple")] });
            return int.reply({ content: `✅ Canal criado: ${chan}`, ephemeral: true });
        } catch (e) {
            return int.reply({ content: "❌ Erro ao criar canal. Verifique as permissões.", ephemeral: true });
        }
    }

    if (int.customId.startsWith('staff_app_') || int.customId.startsWith('staff_rej_')) {
        const [action, userId] = int.customId.split('_').slice(1, 3);
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) user.send(action === 'app' ? "✅ Sua ficha foi aprovada!" : "❌ Sua ficha foi recusada.").catch(() => {});
        await int.reply(action === 'app' ? "Aceito." : "Recusado.");
        return int.message.delete().catch(() => {});
    }
});

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.name.startsWith('ficha-')) return;
    if (msg.attachments.size > 0) {
        const config = await SheetsDB.getConfig(msg.guild.id);
        const staffChan = msg.guild.channels.cache.get(config.formStaffChannelId);
        if (staffChan) {
            const file = msg.attachments.first();
            const embed = new EmbedBuilder().setTitle("📋 NOVA FICHA").addFields({name: "Candidato", value: msg.author.tag}).setColor("Orange");
            if (!file.contentType?.includes('video')) embed.setImage(file.url);
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`staff_app_${msg.author.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`staff_rej_${msg.author.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
            );

            await staffChan.send({ content: config.staffRoleId ? `<@&${config.staffRoleId}>` : "", embeds: [embed], components: [row] });
            if (file.contentType?.includes('video')) await staffChan.send({ content: `🎥 Vídeo: ${file.url}` });
            
            await msg.channel.send("✅ Enviado! Canal fechando...");
            setTimeout(() => msg.channel.delete().catch(() => {}), 4000);
        }
    }
});

// --- ROTAS SITE ---

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
    if (!guild) return ctx.body = "Bot não está no servidor!";
    
    const config = await SheetsDB.getConfig(ctx.params.id);
    const stats = { members: guild.memberCount, boosts: guild.premiumSubscriptionCount, channels: guild.channels.cache.size };

    await ctx.render('config', { 
        guild, config, stats,
        channels: guild.channels.cache, 
        roles: guild.roles.cache,
        page: ctx.query.p || 'general' 
    });
});

router.post('/save/:id', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.status = 401;
    await SheetsDB.saveConfig(ctx.params.id, ctx.request.body);
    ctx.redirect(`/config/${ctx.params.id}?p=${ctx.request.body.last_page}`);
});

app.use(router.routes()).use(router.allowedMethods());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Xenory Pro (Sheets) Online: ${PORT}`);
    // Auto-Ping
    setInterval(() => { axios.get(process.env.CALLBACK_URL.split('/auth')[0]).catch(() => {}); }, 600000);
});

client.login(process.env.TOKEN);
