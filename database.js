const mongoose = require('mongoose');

const GuildSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    isPlus: { type: Boolean, default: false },
    // Segurança e Auto-Role
    autoRoleId: String,
    verifyRoleId: String,
    verifyChannelId: String,
    // Boas-vindas Personalizadas
    welcomeChannelId: String,
    welcomeMsg: { type: String, default: 'Seja bem-vindo(a) ao servidor, {user}!' },
    welcomeDmMsg: { type: String, default: 'Olá {user}, que bom ter você aqui!' },
    enableDm: { type: Boolean, default: false },
    // Recrutamento
    formStaffChannelId: String,
    formCategoryId: String,
    staffRoleId: String,
    formTitle: { type: String, default: 'Recrutamento Staff' }
});

module.exports = mongoose.model('GuildConfig', GuildSchema);
