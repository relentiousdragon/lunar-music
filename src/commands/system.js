const { createEmbed } = require('../utils/embeds');
//
async function execute(message) {
    console.log(`[system] restart requested by ${message.author.tag} (${message.author.id})`);
    await message.channel.send({
        embeds: [createEmbed('System Restart', 'Restarting the bot process... Please wait.', '#00FF00')]
    });
    setTimeout(() => process.exit(1), 1000);
}
//
module.exports = { execute, aliases: [] };
// contributors: @relentiousdragon