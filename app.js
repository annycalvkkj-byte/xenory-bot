// --- AUTO-INSTALADOR DE SEGURANÇA ---
const { execSync } = require('child_process');
try {
    require.resolve('discord.js');
    require.resolve('koa-session');
} catch (e) {
    console.log('📦 Pacotes faltando... Instalando dependências para o Render. Aguarde...');
    try {
        execSync('npm install discord.js dotenv koa koa-router koa-ejs koa-bodyparser koa-session koa-passport passport-discord mongoose axios', { stdio: 'inherit' });
        console.log('✅ Instalação concluída! Reiniciando...');
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
}

// --- INÍCIO DO SISTEMA ---
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const Koa = require('koa');
const Router = require('koa-router');
const render = require('koa-ejs');
const bodyParser = require('koa-bodyparser');
const mongoose = require('mongoose');
const passport = require('koa-passport');
const Strategy = require('passport-discord').Strategy;
const axios = require('axios');
const GuildConfig = require('./database');

// Correção para o módulo de sessão do Koa
let session = require('koa-session');
if (typeof session !== 'function') session = session.default;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ MongoDB Conectado"));

const app = new Koa();
const router = new Router();

// --- CONFIGURAÇÃO ANTI-LOOP (RENDER PROXY) ---
app.proxy = true; 
render(app, { root: __dirname, layout: false, viewExt: 'ejs', cache: false });

app.keys = ['xenory_ultra_stable_render_2026'];
const SESSION_CONFIG = {
    key: 'xenory.sess',
    maxAge: 86400000,
    overwrite: true,
    httpOnly: true,
    signed: true,
    rolling: true,
    renew: true,
    secure: false // Importante para o Render não bugar o cookie
};

app.use(session(SESSION_CONFIG, app));
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

// --- ROTAS DO SITE ---

router.get('/', async (ctx) => { await ctx.render('index'); });

router.get('/login', passport.authenticate('discord'));

router.get('/auth/discord/callback', async (ctx, next) => {
    return passport.authenticate('discord', async (err, user) => {
        if (err || !user) return ctx.redirect('/login');
        await ctx.login(user);
        ctx.session.save(); // Salva a sessão antes do redirect para não dar loop
        ctx.redirect('/dashboard');
    })(ctx, next);
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

// --- LÓGICA DO BOT ---

// 1. Auto-Role (Entrou no Servidor)
client.on('guildMemberAdd', async (member) => {
    const config = await GuildConfig.findOne({ guildId: member.guild.id });
    if (config?.autoRoleId) {
        member.roles.add(config.autoRoleId).catch(() => console.log("Erro: Falta permissão para Auto-Role"));
    }
});

client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await GuildConfig.findOne({ guildId: int.guild.id });

    // 2. Verificação (Ganha cargo novo e REMOVE o cargo de entrada)
    if (int.customId === 'xenory_verify') {
        if (!config?.verifyRoleId) return int.reply({ content: "Sistema não configurado!", ephemeral: true });
        
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        
        return int.reply({ content: "✅ Verificado! O cargo restrito foi removido.", ephemeral: true });
    }

    // 3. Abrir Canal de Recrutamento (Ficha)
    if (int.customId === 'xenory_start_form') {
        try {
            const channel = await int.guild.channels.create({
                name: `ficha-${int.user.username}`,
                type: ChannelType.GuildText,
                parent: config?.formCategoryId || null,
                permissionOverwrites: [
                    { id: int.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: int.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
                ]
            });
            const e = new EmbedBuilder().setTitle("📸 Recrutamento").setDescription(`Olá ${int.user}, envie uma **FOTO ou VÍDEO** agora neste canal.`).setColor("Purple");
            await channel.send({ content: `${int.user}`, embeds: [e] });
            return int.reply({ content: `✅ Canal criado: ${channel}`, ephemeral: true });
        } catch (e) {
            return int.reply({ content: "❌ Erro: O Bot precisa de permissão de Administrador.", ephemeral: true });
        }
    }

    // 4. Botões Staff (Aceitar/Recusar)
    if (int.customId.startsWith('staff_app_') || int.customId.startsWith('staff_rej_')) {
        const action = int.customId.split('_')[1];
        const userId = int.customId.split('_')[2];
        const user = await client.users.fetch(userId).catch(() => null);

        if (action === 'app') {
            if (user) user.send(`✅ Parabéns! Sua ficha em **${int.guild.name}** foi aprovada.`).catch(() => {});
            await int.reply(`Candidato <@${userId}> aprovado.`);
        } else {
            if (user) user.send(`❌ Sinto muito. Sua ficha em **${int.guild.name}** foi recusada.`).catch(() => {});
            await int.reply(`Candidato <@${userId}> recusado.`);
        }
        return int.message.delete().catch(() => {});
    }
});

// 5. Receber Foto/Vídeo e mandar para Staff
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.name.startsWith('ficha-')) return;

    if (msg.attachments.size > 0) {
        const config = await GuildConfig.findOne({ guildId: msg.guild.id });
        const staffChan = msg.guild.channels.cache.get(config?.formStaffChannelId);
        
        if (staffChan) {
            const file = msg.attachments.first();
            const isVideo = file.contentType?.includes('video');

            const embed = new EmbedBuilder()
                .setTitle("📋 NOVA FICHA RECEBIDA")
                .addFields({ name: "Candidato", value: `${msg.author.tag} (${msg.author.id})` })
                .setColor("Orange");

            if (!isVideo) embed.setImage(file.url);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`staff_app_${msg.author.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`staff_rej_${msg.author.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
            );

            await staffChan.send({ 
                content: config.staffRoleId ? `<@&${config.staffRoleId}>` : "Nova ficha para avaliação!", 
                embeds: [embed], 
                components: [row] 
            });

            if (isVideo) await staffChan.send({ content: `🎥 **VÍDEO DO CANDIDATO:** ${file.url}` });

            await msg.channel.send("✅ Mídia enviada para a Staff! Este canal fechará em breve.");
            setTimeout(() => msg.channel.delete().catch(() => {}), 5000);
        }
    }
});

// Comandos /form e /verificar
client.on('messageCreate', async (msg) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    
    if (msg.content.toLowerCase() === '/form') {
        const config = await GuildConfig.findOne({ guildId: msg.guild.id });
        const e = new EmbedBuilder().setTitle(config?.formTitle || "Recrutamento").setDescription("Clique para iniciar.").setColor("Purple");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_start_form').setLabel('Iniciar').setStyle(ButtonStyle.Primary));
        msg.channel.send({ embeds: [e], components: [r] });
    }

    if (msg.content.toLowerCase() === '/verificar') {
        const e = new EmbedBuilder().setTitle("🛡️ Verificação").setDescription("Clique abaixo para se verificar.").setColor("Blue");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_verify').setLabel('Verificar').setStyle(ButtonStyle.Success));
        msg.channel.send({ embeds: [e], components: [r] });
    }
});

app.use(router.routes()).use(router.allowedMethods());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Xenory On: Porta ${PORT}`);
    
    // SISTEMA AUTO-PING (Evita o Render dormir)
    setInterval(() => {
        const siteUrl = process.env.CALLBACK_URL.split('/auth')[0];
        axios.get(siteUrl).then(() => console.log("⚡ Ping de estabilidade enviado.")).catch(() => {});
    }, 1000 * 60 * 10); // A cada 10 minutos
});

client.login(process.env.TOKEN);
