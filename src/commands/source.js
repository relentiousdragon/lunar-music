const { createEmbed } = require('../utils/embeds');
const { getDefaultSearchSource, setDefaultSearchSource, clearDefaultSearchSource, VALID_SOURCES } = require('../utils/guildSettings');
//
async function execute(message, args) {
    if (!message.guild) return message.channel.send({ content: 'This command can only be used in a server.', ephemeral: Boolean(message.slash) });
    const requested = args[0]?.toLowerCase();
    if (!requested) {
        const current = getDefaultSearchSource(message.guild.id) || 'automatic fallback order';
        return message.channel.send({ embeds: [createEmbed('Default Search Source', `Current default: **${current}**\nSet one with \`source <youtube|youtubemusic|soundcloud|spotify|deezer|applemusic|tidal>\`.`, '#6A5ACD')], ...(message.slash ? { ephemeral: true } : {}) });
    }
    if (['auto', 'reset', 'default'].includes(requested)) {
        clearDefaultSearchSource(message.guild.id);
        return message.channel.send({ embeds: [createEmbed('Default Search Source', 'Reset to the automatic node fallback order.', '#00FF00')], ...(message.slash ? { ephemeral: true } : {}) });
    }
    if (!VALID_SOURCES.has(requested)) {
        return message.channel.send({ embeds: [createEmbed('Invalid Search Source', `Choose one of: ${[...VALID_SOURCES].join(', ')}, or \`auto\`.`, '#FF0000')], ...(message.slash ? { ephemeral: true } : {}) });
    }
    setDefaultSearchSource(message.guild.id, requested);
    return message.channel.send({ embeds: [createEmbed('Default Search Source', `Text searches in this server now use **${requested}** unless a \`--source\` flag is supplied.`, '#00FF00')], ...(message.slash ? { ephemeral: true } : {}) });
}
//
module.exports = { execute, aliases: ['defaultsource'] };
// contributors: @relentiousdragon