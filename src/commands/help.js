const { EmbedBuilder } = require('discord.js');
const { getEmoji } = require('../utils/emojis');
const { getBotName, getBotFooter } = require('../utils/branding');
//
async function execute(message) {
    const guild = message.guild;
    const channel = message.channel;

    const helpEmbed = new EmbedBuilder()
        .setTitle(`${getEmoji('star', guild, channel)} ${getBotName()} Music`)
        .setDescription('Here are the available commands:')
        .addFields(
            { name: 'Playback', value: '`play [query/url]` - Play music\n`skip` - Skip current song\n`back` - Play previous song\n`previous` - View play history\n`seek [time]` - Jump to position (e.g., `1:30`)\n`pause` / `resume` - Control playback\n`stop` - Stop & leave\n`loop [track/queue/off]` - Toggle repeat' },
            { name: 'Queue', value: '`queue` - View what\'s up next\n`skipall` / `clear` - Clear queue and stop' },
            { name: 'Stats', value: '`top` - Most played in this server\n`global` - Most played across all servers' },
            { name: 'Effects', value: '`nightcore`, `vaporwave`, `tremolo`, `vibrato`, `rotation`, `lowpass`, `echo`, `karaoke`' },
            { name: 'Search Platforms', value: `Default Platform: ${getEmoji('spotify', guild, channel)} Spotify\nUse flags with \`play\` command:\n${getEmoji('soundcloud', guild, channel)} \`--sc\` SoundCloud • ${getEmoji('deezer', guild, channel)} \`--dz\` Deezer\n${getEmoji('apple_music', guild, channel)} \`--am\` Apple Music • ${getEmoji('tidal', guild, channel)} \`--td\` Tidal\n\`--sr\` Show search results` },
            { name: 'Other', value: '`restart` / `fix` - Restart player (connection issues)\n`help` - Show this message\n`credits` - Project credits and repository\n`sr` - Restart the bot' }
        )
        .setColor('#6A5ACD')
        .setFooter(getBotFooter());

    message.channel.send({ embeds: [helpEmbed] });
}
//
module.exports = { execute, aliases: ['h'] };
// contributors: @relentiousdragon
