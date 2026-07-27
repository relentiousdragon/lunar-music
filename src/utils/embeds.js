const { EmbedBuilder } = require('discord.js');
const { getEmoji } = require('./emojis');
const { getBotFooter } = require('./branding');
const logger = require('./logger');
//
function createEmbed(title, description, color = '#2F3136') {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter(getBotFooter())
        .setTimestamp();
}

function handleError(message, error, customMessage = null) {
    logger.error('command_error', {
        error: error.message,
        query: message?.content,
        user: message?.author?.tag,
        guild: message?.guild?.id
    });

    const icon = getEmoji('xmark', message?.guild, message?.channel);
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setDescription(`${icon} ${customMessage || 'An error occurred'}`)
        .addFields({
            name: 'Details',
            value: `\`\`\`${error.message.slice(0, 1000)}\`\`\``
        });

    message.channel.send({ embeds: [embed] });
}
//
module.exports = { createEmbed, handleError };
// contributors: @relentiousdragon
