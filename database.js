const mongoose = require('mongoose');

const GuildSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    // Segurança
    autoRoleId: String,     // Cargo que ganha ao entrar
    verifyRoleId: String,   // Cargo que ganha ao verificar (e remove o de cima)
    verifyChannelId: String,
    // Recrutamento
    formStaffChannelId: String,
    formCategoryId: String,
    staffRoleId: String,
    formTitle: { type: String, default: 'Recrutamento Staff' }
});

module.exports = mongoose.model('GuildConfig', GuildSchema);
