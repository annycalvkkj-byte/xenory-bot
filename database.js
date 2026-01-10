const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Conexão com as variáveis de ambiente do Render
const creds = JSON.parse(process.env.GOOGLE_SHEETS_JSON);
const docId = process.env.SPREADSHEET_ID;

const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(docId, serviceAccountAuth);

const SheetsDB = {
    // Inicializar conexão
    init: async () => {
        await doc.loadInfo();
        console.log(`✅ Planilha conectada: ${doc.title}`);
    },

    // --- ABA: CONFIGURAÇÕES ---
    getConfig: async (guildId) => {
        const sheet = doc.sheetsByTitle['Configuracoes'];
        const rows = await sheet.getRows();
        const row = rows.find(r => r.get('guildId') === guildId);
        if (!row) return null;
        
        // Converte a linha em objeto simples para o código ler
        return {
            guildId: row.get('guildId'),
            autoRoleId: row.get('autoRoleId'),
            verifyRoleId: row.get('verifyRoleId'),
            welcomeMsg: row.get('welcomeMsg'),
            personalidade: row.get('personalidade'),
            isPlus: row.get('isPlus') === 'TRUE',
            formStaffChannelId: row.get('formStaffChannelId'),
            formCategoryId: row.get('formCategoryId'),
            staffRoleId: row.get('staffRoleId'),
            formTitle: row.get('formTitle') || 'Recrutamento Staff'
        };
    },

    saveConfig: async (guildId, data) => {
        const sheet = doc.sheetsByTitle['Configuracoes'];
        const rows = await sheet.getRows();
        let row = rows.find(r => r.get('guildId') === guildId);

        const updateData = {
            guildId,
            autoRoleId: data.autoRoleId || '',
            verifyRoleId: data.verifyRoleId || '',
            welcomeMsg: data.welcomeMsg || '',
            personalidade: data.personalidade || '',
            isPlus: data.isPlus || 'FALSE',
            formStaffChannelId: data.formStaffChannelId || '',
            formCategoryId: data.formCategoryId || '',
            staffRoleId: data.staffRoleId || '',
            formTitle: data.formTitle || 'Recrutamento Staff'
        };

        if (row) {
            Object.assign(row, updateData);
            await row.save();
        } else {
            await sheet.addRow(updateData);
        }
    },

    // --- ABA: COMPRAS ---
    savePurchase: async (purchase) => {
        const sheet = doc.sheetsByTitle['Compras'];
        await sheet.addRow({
            ID_Transacao: `TXN_${Date.now()}`,
            ID_Usuario: purchase.userId,
            Email: purchase.email,
            Item_Comprado: purchase.item,
            Valor: purchase.value,
            Data: new Date().toLocaleString('pt-BR'),
            Status_Pagamento: 'Aprovado'
        });
    }
};

module.exports = SheetsDB;
