
const mongoose = require('mongoose');

const GuildSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    // Segurança
    autoRoleId: String,     // Cargo que ganha ao entrar (ex: Não Verificado)
    verifyRoleId: String,   // Cargo que ganha ao clicar no botão
    verifyChannelId: String,
    // Recrutamento
    formStaffChannelId: String,
    formCategoryId: String,
    staffRoleId: String,
    formTitle: { type: String, default: 'Recrutamento Staff' }
});

module.exports = mongoose.model('GuildConfig', GuildSchema);
