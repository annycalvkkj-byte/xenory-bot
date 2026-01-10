require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const Koa = require('koa');
const Router = require('koa-router');
const render = require('koa-ejs');
const bodyParser = require('koa-bodyparser');
const passport = require('koa-passport');
const Strategy = require('passport-discord').Strategy;
const session = require('koa-session');
const SheetsDB = require('./database');
const axios = require('axios');

const client = new Client({
    intents: [3276799], // All Intents
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

SheetsDB.init();

const app = new Koa();
const router = new Router();
app.proxy = true;
app.keys = ['xenory_key_2026'];

render(app, { root: __dirname, layout: false, viewExt: 'ejs', cache: false });
app.use(session({ key: 'koa.sess', maxAge: 86400000 }, app));
app.use(bodyParser());
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));
passport.use(new Strategy({
    clientID: process.env.CLIENT_ID, clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL, scope: ['identify', 'guilds']
}, (at, rt, profile, done) => done(null, profile)));

// --- LÓGICA DO BOT ---
client.on('guildMemberAdd', async (member) => {
    const config = await SheetsDB.getConfig(member.guild.id);
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
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        return int.reply({ content: "✅ Verificado!", ephemeral: true });
    }

    if (int.customId === 'xenory_start_form') {
        const chan = await int.guild.channels.create({
            name: `ficha-${int.user.username}`, type: ChannelType.GuildText, parent: config.formCategoryId || null,
            permissionOverwrites: [{ id: int.guild.id, deny: [8n] }, { id: int.user.id, allow: [1024n, 2048n, 32768n] }]
        });
        await chan.send({ content: `${int.user}`, embeds: [new EmbedBuilder().setTitle("📸 Envie sua Mídia").setDescription("Mande foto/vídeo agora.").setColor("Purple")] });
        return int.reply({ content: "Canal criado!", ephemeral: true });
    }

    if (int.customId.startsWith('staff_app_') || int.customId.startsWith('staff_rej_')) {
        const [action, userId] = int.customId.split('_').slice(1, 3);
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) user.send(action === 'app' ? "✅ Aprovado!" : "❌ Recusado.").catch(() => {});
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

// --- ROTAS WEB ---
router.get('/', async (ctx) => { await ctx.render('index'); });
router.get('/login', passport.authenticate('discord'));
router.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (ctx) => ctx.redirect('/dashboard'));

router.get('/dashboard', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.redirect('/login');
    await ctx.render('dashboard', { guilds: ctx.state.user.guilds.filter(g => (g.permissions & 0x8) === 0x8) });
});

router.get('/config/:id', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.redirect('/login');
    const guild = await client.guilds.fetch(ctx.params.id).catch(() => null);
    const config = await SheetsDB.getConfig(ctx.params.id);
    await ctx.render('config', { 
        guild, config, page: ctx.query.p || 'general',
        channels: guild.channels.cache, roles: guild.roles.cache,
        stats: { members: guild.memberCount, boosts: guild.premiumSubscriptionCount, channels: guild.channels.cache.size }
    });
});

router.post('/save/:id', async (ctx) => {
    if (!ctx.isAuthenticated()) return ctx.status = 401;
    await SheetsDB.saveConfig(ctx.params.id, ctx.request.body);
    ctx.redirect(`/config/${ctx.params.id}?p=${ctx.request.body.last_page}`);
});

app.use(router.routes()).use(router.allowedMethods());
app.listen(process.env.PORT || 3000, () => {
    console.log("🚀 Xenory Pro Online");
    setInterval(() => { axios.get(process.env.CALLBACK_URL.split('/auth')[0]).catch(() => {}); }, 600000);
});
client.login(process.env.TOKEN);
