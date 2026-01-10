require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType 
} = require('discord.js');
const express = require('express');
const passport = require('passport');
const session = require('express-session');
const Strategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');
const SheetsDB = require('./database'); // Importa seu database.js corrigido

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

// Inicializa a conexão com a Planilha Google
SheetsDB.init();

const app = express();

// --- CONFIGURAÇÃO DE ESTABILIDADE (RENDER) ---
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'xenory_express_pro_secret_2026',
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: true, // Render usa HTTPS
        sameSite: 'none', 
        maxAge: 60000 * 60 * 24 
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new Strategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (at, rt, profile, done) => done(null, profile)));

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
    if (!guild) return res.send("O Bot precisa estar no servidor primeiro!");

    // Busca dados salvos na Planilha
    const config = await SheetsDB.getConfig(req.params.id);
    
    const stats = {
        members: guild.memberCount,
        boosts: guild.premiumSubscriptionCount || 0,
        channels: guild.channels.cache.size
    };

    res.render('config', { 
        guild, 
        config, 
        stats,
        channels: guild.channels.cache, 
        roles: guild.roles.cache,
        page: req.query.p || 'general' 
    });
});

app.post('/save/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    // Salva na planilha e espera terminar
    await SheetsDB.saveConfig(req.params.id, req.body);
    
    // Força salvar sessão e volta para a mesma página
    req.session.save(() => {
        res.redirect(`/config/${req.params.id}?p=${req.body.last_page || 'general'}`);
    });
});

// --- LÓGICA DO BOT ( SheetsDB ) ---

// Boas-vindas e Auto-Role
client.on('guildMemberAdd', async (member) => {
    const config = await SheetsDB.getConfig(member.guild.id);
    if (!config) return;

    // Dá cargo de entrada
    if (config.autoRoleId) member.roles.add(config.autoRoleId).catch(() => {});

    // Mensagem no canal
    if (config.welcomeChannelId) {
        const chan = member.guild.channels.cache.get(config.welcomeChannelId);
        if (chan) chan.send(config.welcomeMsg.replace('{user}', `<@${member.id}>`)).catch(() => {});
    }

    // Mensagem na DM
    if (config.enableDm && config.welcomeDmMsg) {
        member.send(config.welcomeDmMsg.replace('{user}', member.user.username)).catch(() => {});
    }
});

// Interações: Verificação e Recrutamento
client.on('interactionCreate', async (int) => {
    if (!int.guild) return;
    const config = await SheetsDB.getConfig(int.guild.id);

    // Botão de Verificação
    if (int.customId === 'xenory_verify') {
        if (!config?.verifyRoleId) return int.reply({ content: "Verificação não configurada!", ephemeral: true });
        
        await int.member.roles.add(config.verifyRoleId).catch(() => {});
        if (config.autoRoleId) await int.member.roles.remove(config.autoRoleId).catch(() => {});
        
        return int.reply({ content: "✅ Verificado com sucesso!", ephemeral: true });
    }

    // Botão Iniciar Recrutamento
    if (int.customId === 'xenory_start_form') {
        if (!config.formStaffChannelId) return int.reply({ content: "❌ Recrutamento não configurado pela Staff!", ephemeral: true });

        const channel = await int.guild.channels.create({
            name: `ficha-${int.user.username}`,
            type: ChannelType.GuildText,
            parent: config.formCategoryId || null,
            permissionOverwrites: [
                { id: int.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: int.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
            ]
        });

        const e = new EmbedBuilder()
            .setTitle(config.formTitle || "Recrutamento")
            .setDescription(`Olá ${int.user}, envie uma **FOTO ou VÍDEO** agora para ser avaliado.`)
            .setColor("Purple");
        
        await channel.send({ content: `${int.user}`, embeds: [e] });
        return int.reply({ content: `✅ Canal de ficha criado: ${channel}`, ephemeral: true });
    }

    // Aceitar / Recusar Ficha
    if (int.customId.startsWith('staff_app_') || int.customId.startsWith('staff_rej_')) {
        const action = int.customId.split('_')[1];
        const userId = int.customId.split('_')[2];
        const user = await client.users.fetch(userId).catch(() => null);

        if (action === 'app') {
            if (user) user.send("✅ Sua ficha foi aprovada!").catch(() => {});
            await int.reply(`Candidato aprovado.`);
        } else {
            if (user) user.send("❌ Sua ficha foi recusada.").catch(() => {});
            await int.reply(`Candidato recusado.`);
        }
        return int.message.delete().catch(() => {});
    }
});

// Captura de Foto/Vídeo no canal de ficha
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.name.startsWith('ficha-')) return;

    if (msg.attachments.size > 0) {
        const config = await SheetsDB.getConfig(msg.guild.id);
        const staffChan = msg.guild.channels.cache.get(config?.formStaffChannelId);
        
        if (staffChan) {
            const file = msg.attachments.first();
            const embed = new EmbedBuilder()
                .setTitle("📋 NOVA FICHA RECEBIDA")
                .addFields({ name: "Candidato", value: `${msg.author.tag} (${msg.author.id})` })
                .setColor("Orange");

            if (!file.contentType?.includes('video')) embed.setImage(file.url);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`staff_app_${msg.author.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`staff_rej_${msg.author.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
            );

            await staffChan.send({ 
                content: config.staffRoleId ? `<@&${config.staffRoleId}>` : "Nova ficha!", 
                embeds: [embed], 
                components: [row] 
            });

            if (file.contentType?.includes('video')) await staffChan.send({ content: `🎥 **VÍDEO DO CANDIDATO:** ${file.url}` });

            await msg.channel.send("✅ Enviado com sucesso! Fechando canal...");
            setTimeout(() => msg.channel.delete().catch(() => {}), 5000);
        }
    }
});

// Comandos de Chat (/form e /verificar)
client.on('messageCreate', async (msg) => {
    if (!msg.content.startsWith('/') || msg.author.bot) return;
    if (!msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return;

    const cmd = msg.content.toLowerCase();
    const config = await SheetsDB.getConfig(msg.guild.id);

    if (cmd === '/form') {
        const e = new EmbedBuilder().setTitle(config.formTitle || "Recrutamento").setDescription("Clique abaixo para iniciar.").setColor("Purple");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_start_form').setLabel('Iniciar').setStyle(ButtonStyle.Primary));
        msg.channel.send({ embeds: [e], components: [r] });
    }

    if (cmd === '/verificar') {
        const e = new EmbedBuilder().setTitle("🛡️ Verificação").setDescription("Clique para se verificar.").setColor("Blue");
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('xenory_verify').setLabel('Verificar').setStyle(ButtonStyle.Success));
        msg.channel.send({ embeds: [e], components: [r] });
    }
});

// --- INICIALIZAÇÃO ---

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Xenory Pro On: Porta ${PORT}`);
    
    // AUTO-PING para o Render não dormir
    setInterval(() => {
        const url = process.env.CALLBACK_URL.split('/auth')[0];
        axios.get(url).then(() => console.log("⚡ Ping de estabilidade.")).catch(() => {});
    }, 1000 * 60 * 10);
});

client.login(process.env.TOKEN);
