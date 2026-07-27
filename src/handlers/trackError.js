const { EmbedBuilder } = require('discord.js');
const client = require('../client');
const manager = require('../manager');
const { playerStates } = require('../state');
const { getEmoji } = require('../utils/emojis');
const { getBotFooter } = require('../utils/branding');
//
function registerTrackError() {
    manager.on('trackException', (player, track, exception) => {
        const guildId = player.guildId;
        const trackInfo = track || {};
        console.log(`[player] track error in ${guildId}: "${trackInfo.title || 'unknown'}" - ${exception?.message || exception}`);

        const state = playerStates.get(guildId);
        if (!state?.isBreaking) {
            playerStates.delete(guildId);
        }

        const textChannel = client.channels.cache.get(player.textChannelId || player.textChannel);
        const truncatedName = trackInfo.title?.length > 15 ? trackInfo.title.slice(0, 15) + '...' : (trackInfo.title || 'Unknown');

        const guild = textChannel?.guild;
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(`${getEmoji('xmark', guild, textChannel)} Unable to Play: ${truncatedName}`)
            .setDescription('This could be due to:\n - Unsupported platform\n - Invalid URL\n- Server-side restrictions')
            .addFields({ name: 'Troubleshooting', value: '1. Check bot permissions\n2. Try a different source\n3. Use `l.fix` or `l.sr`' })
            .setFooter(getBotFooter());

        if (trackInfo.artworkUrl) {
            embed.setThumbnail(trackInfo.artworkUrl);
        }

        textChannel?.send({ embeds: [embed] });

        const { setQueueTimeout } = require('./playerEvents');
        setQueueTimeout(guildId, 300000);
    });
}
//
module.exports = { registerTrackError };
// contributors: @relentiousdragon