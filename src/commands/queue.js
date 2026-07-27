const { EmbedBuilder } = require('discord.js');
const manager = require('../manager');
const client = require('../client');
const { playerStates } = require('../state');
const { createEmbed } = require('../utils/embeds');
const { formatTime, getFormattedDuration, getTrackUrl } = require('../utils/format');
const { getEmoji } = require('../utils/emojis');
const { getBotFooter } = require('../utils/branding');
//
function generateQueuePages(player, guildId, guild, channel) {
    const pages = [];
    const itemsPerPage = 10;

    const current = player.current;
    const tracks = [current, ...player.queue.tracks].filter(Boolean);
    if (tracks.length === 0) return pages;

    const totalDurationMs = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
    const totalDuration = formatTime(totalDurationMs);

    const loopStatus = player.loop === 'queue'
        ? (getEmoji('loop', guild, channel) || '🔁')
        : (getEmoji('headphones', guild, channel) || '🎵');

    const voiceChannel = client.channels.cache.get(player.voiceChannelId);
    const state = playerStates.get(guildId);
    const manualPos = state?.manualPos || 0;

    for (let i = 0; i < tracks.length; i += itemsPerPage) {
        const pageTracks = tracks.slice(i, i + itemsPerPage);
        const pageDescription = pageTracks.map((track, index) => {
            const globalIndex = i + index;
            const name = track.title || track.name || 'Unknown';
            const truncatedName = name.length > 45 ? name.substring(0, 45) + '...' : name;
            const url = getTrackUrl(track);
            const duration = getFormattedDuration(track);
            const currentPos = Math.max(0, manualPos);

            const timeInfo = globalIndex === 0
                ? `\`${formatTime(currentPos)}/${duration}\``
                : `\`${duration}\``;

            const loopEmoji = (player.loop === 'track' && globalIndex === 0)
                ? ' 🔁'
                : '';

            return `**${globalIndex + 1}.** [${truncatedName}](${url})${loopEmoji} - ${timeInfo}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`${loopStatus} Queue for ${voiceChannel?.name || 'Voice Channel'}`)
            .setDescription(pageDescription || 'No songs in queue')
            .setColor('#6A5ACD')
            .setFooter(getBotFooter(`Page ${Math.floor(i / itemsPerPage) + 1}/${Math.ceil(tracks.length / itemsPerPage)}  •  Queue ${totalDuration}`));

        pages.push(embed);
    }
    return pages;
}

async function execute(message, args) {
    const guild = message.guild;
    const channel = message.channel;
    const queuePlayer = manager.players.get(message.guild.id);
    if (!queuePlayer || (!queuePlayer.current && queuePlayer.queue.tracks.length === 0)) {
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('headphones', guild, channel)} Queue Status`, 'The queue is currently empty', '#FFA500')]
        });
    }

    const pages = generateQueuePages(queuePlayer, message.guild.id, guild, channel);
    if (pages.length === 0) {
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('headphones', guild, channel)} Queue Status`, 'The queue is currently empty', '#FFA500')]
        });
    }

    let requestedPage = parseInt(args[0]);
    if (isNaN(requestedPage)) requestedPage = 1;
    const currentPage = Math.max(1, Math.min(requestedPage, pages.length));

    return message.channel.send({ embeds: [pages[currentPage - 1]] });
}
//
module.exports = { execute, aliases: ['q'] };
// contributors: @relentiousdragon
