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
        } catch (e) { console.error("❌ Erro no ID da Planilha ou Permissão!"); }
    },
    getConfig: async (guildId) => {
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
    },
    saveConfig: async (guildId, data) => {
        const sheet = doc.sheetsByTitle['Configuracoes'];
        const rows = await sheet.getRows();
        let r = rows.find(row => row.get('guildId') === guildId);
        const d = {
            guildId,
            autoRoleId: data.autoRoleId || '',
            verifyRoleId: data.verifyRoleId || '',
            welcomeChannelId: data.welcomeChannelId || '',
            welcomeMsg: data.welcomeMsg || '',
            welcomeDmMsg: data.welcomeDmMsg || '',
            enableDm: data.enableDm ? 'TRUE' : 'FALSE',
            formStaffChannelId: data.formStaffChannelId || '',
            formCategoryId: data.formCategoryId || '',
            staffRoleId: data.staffRoleId || '',
            formTitle: data.formTitle || 'Recrutamento'
        };
        if (r) { Object.assign(r, d); await r.save(); }
        else { await sheet.addRow(d); }
    }
};

module.exports = SheetsDB;
