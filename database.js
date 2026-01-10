const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const creds = JSON.parse(process.env.GOOGLE_SHEETS_JSON);
const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

const SheetsDB = {
    init: async () => {
        try {
            await doc.loadInfo();
            console.log(`✅ Planilha conectada: ${doc.title}`);
        } catch (e) { console.error("❌ Erro de Conexão:", e.message); }
    },

    getConfig: async (guildId) => {
        try {
            const sheet = doc.sheetsByTitle['Configuracoes'];
            const rows = await sheet.getRows();
            const r = rows.find(row => row.get('guildId') === guildId);
            if (!r) return {};
            return {
                guildId: r.get('guildId'),
                autoRoleId: r.get('autoRoleId'),
                verifyRoleId: r.get('verifyRoleId'),
                welcomeChannelId: r.get('welcomeChannelId'),
                welcomeMsg: r.get('welcomeMsg'),
                welcomeDmMsg: r.get('welcomeDmMsg'),
                enableDm: r.get('enableDm') === 'TRUE',
                formStaffChannelId: r.get('formStaffChannelId'),
                formCategoryId: r.get('formCategoryId'),
                staffRoleId: r.get('staffRoleId'),
                formTitle: r.get('formTitle')
            };
        } catch (e) { return {}; }
    },

    saveConfig: async (guildId, data) => {
        try {
            const sheet = doc.sheetsByTitle['Configuracoes'];
            const rows = await sheet.getRows();
            let r = rows.find(row => row.get('guildId') === guildId);

            // Mapeamento exato dos nomes que vêm do formulário HTML
            const updateData = {
                guildId: guildId,
                autoRoleId: data.autoRoleId || '',
                verifyRoleId: data.verifyRoleId || '',
                welcomeChannelId: data.welcomeChannelId || '',
                welcomeMsg: data.welcomeMsg || '',
                welcomeDmMsg: data.welcomeDmMsg || '',
                enableDm: data.enableDm ? 'TRUE' : 'FALSE', // Converte checkbox
                formStaffChannelId: data.formStaffChannelId || '',
                formCategoryId: data.formCategoryId || '',
                staffRoleId: data.staffRoleId || '',
                formTitle: data.formTitle || 'Recrutamento'
            };

            if (r) {
                Object.assign(r, updateData);
                await r.save();
                console.log("✅ Planilha Atualizada!");
            } else {
                await sheet.addRow(updateData);
                console.log("✅ Nova Linha Criada!");
            }
        } catch (e) { console.error("❌ Erro ao salvar:", e.message); }
    }
};

module.exports = SheetsDB;
