const mongoose = require('mongoose');
const GuildSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    isPlus: { type: Boolean, default: false },
    autoRoleId: String,
    verifyChannelId: String,
    verifyRoleId: String,
    roleMsgChannelId: String,
    roleId1: String,
    roleLabel1: String,
    roleEmoji1: String,
    formRequestChannelId: String,
    formStaffChannelId: String,
    formCategoryId: String,
    staffRoleId: String,
    formTitle: { type: String, default: 'Recrutamento Staff' }
});
module.exports = mongoose.model('GuildConfig', GuildSchema);
