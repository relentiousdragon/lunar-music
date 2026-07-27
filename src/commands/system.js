const { createEmbed } = require('../utils/embeds');
const { isDeveloper } = require('../utils/permissions');
const logger = require('../utils/logger');
//
async function execute(message) {
    if (!isDeveloper(message)) {
        return message.channel.send({
            embeds: [createEmbed('Permission Denied', 'Only configured bot developers can restart the bot process.', '#FF0000')],
            ...(message.slash ? { ephemeral: true } : {})
        });
    }

    logger.warn('process_restart_requested', {
        user: message.author.tag || message.author.username,
        userId: message.author.id
    });
    await message.channel.send({
        embeds: [createEmbed('System Restart', 'Restarting the bot process... Please wait.', '#00FF00')]
    });
    setTimeout(() => process.exit(1), 1000);
}
//
module.exports = { execute, aliases: [] };
// contributors: @relentiousdragon
