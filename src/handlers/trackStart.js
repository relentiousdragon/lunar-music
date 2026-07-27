const { EmbedBuilder } = require('discord.js');
const client = require('../client');
const manager = require('../manager');
const { playerStates, colorCache, acquireLyricsSlot, releaseLyricsSlot } = require('../state');
const { formatTime, getFormattedDuration, getRequesterId } = require('../utils/format');
const { getDominantColor, getPlatformColor } = require('../utils/color');
const { getPlatformEmoji, fetchTrackMetadata } = require('../utils/metadata');
const { fetchLyrics } = require('../utils/lyrics');
const { updateSongStats, getTrackPlaysForUser } = require('../utils/stats');
const { setVoiceChannelStatus } = require('../utils/voice');
const { getActiveFiltersString } = require('../utils/filters');
const { getBotName } = require('../utils/branding');
const { getEmoji } = require('../utils/emojis');

const SET_VOICE_STATUS = BigInt(1) << BigInt(48);
//
function registerTrackStart() {
    manager.on('trackStart', async (player, track) => {
        const guildId = player.guildId;
        const { clearQueueTimeout } = require('./playerEvents');
        clearQueueTimeout(guildId);

        let state = playerStates.get(guildId);
        if (!state) {
            state = { nightcore: false };
            playerStates.set(guildId, state);
        }

        state.pos = player.position;
        state.timestamp = Date.now();
        state.npMessage = null;
        state.lyrics = null;
        state.lastLyrics = null;
        state.nextLyricUpdate = 0;
        state.textChannelId = player.textChannelId || player.textChannel;
        if (!state.recoveryRestarted) {
            state.manualPos = 0;
        } else {
            state.recoveryRestarted = false;
        }
        state.lastWatchdogUpdate = Date.now();
        state.lastSeekTime = 0;
        state.recoveryRestarted = false;

        if (state.nightcore === undefined) state.nightcore = false;
        if (state.vaporwave === undefined) state.vaporwave = false;
        if (state.tremolo === undefined) state.tremolo = false;
        if (state.vibrato === undefined) state.vibrato = false;

        if (state.sessionTracks === undefined) {
            state.sessionTracks = 0;
            state.sessionDuration = 0;
        }
        state.sessionTracks++;
        state.sessionDuration += (track.duration || 0);

        const requesterId = getRequesterId(track);
        updateSongStats(guildId, track, requesterId);

        const trackLen = track.duration || 0;
        console.log(`[player] playing: ${track.title} | ${formatTime(trackLen)} | guild: ${guildId}`);

        if (!state.nightcore && !state.vaporwave) {
            if (acquireLyricsSlot(guildId)) {
                fetchLyrics(track).then(async lyrics => {
                    if (lyrics && playerStates.has(guildId)) {
                        const s = playerStates.get(guildId);
                        s.lyrics = lyrics;
                        console.log(`[lyrics] found synced lyrics for "${track.title}"`);
                        const { updateNowPlayingEmbed } = require('../utils/filters');
                        await updateNowPlayingEmbed(guildId);
                    } else {
                        releaseLyricsSlot(guildId);
                    }
                }).catch(() => {
                    releaseLyricsSlot(guildId);
                });
            }
        }

        const textChannel = client.channels.cache.get(player.textChannelId || player.textChannel);
        const voiceChannel = client.channels.cache.get(player.voiceChannelId);

        const platformEmoji = getPlatformEmoji(track, textChannel?.guild, textChannel);
        let color = getPlatformColor(track);

        const art = track.artworkUrl || track.thumbnail;

        const applyColorAndSend = async () => {
            if (art) {
                if (colorCache.has(art)) {
                    color = colorCache.get(art);
                } else {
                    try {
                        const domColor = await getDominantColor(art);
                        if (domColor) {
                            color = domColor;
                            colorCache.set(art, domColor);
                        }
                    } catch (e) {
                        //
                    }
                }
            }

            const activeFilters = getActiveFiltersString(playerStates.get(guildId));
            const trackId = track.identifier || track.title || 'unknown';

            let heartEmoji = '';
            const userPlays = getTrackPlaysForUser(guildId, trackId, requesterId);
            heartEmoji = userPlays > 15 ? ' ❤️' : '';

            const artistName = track.author || getBotName();
            const metadata = await fetchTrackMetadata(track.title, artistName);
            const footerIcon = metadata?.artistPfp || client.user.displayAvatarURL();

            const embed = new EmbedBuilder()
                .setTitle('Now Playing')
                .setDescription(`${platformEmoji} [${track.title}](${track.uri})`)
                .addFields(
                    { name: 'Duration', value: `\`${trackLen ? formatTime(trackLen) : 'Unknown'}\``, inline: true },
                    { name: 'Requested By', value: `<@${getRequesterId(track)}>${heartEmoji}`, inline: true }
                );

            if (player.queue.tracks.length > 0) {
                const nextTrack = player.queue.tracks[0];
                const nextTitle = nextTrack.title || nextTrack.name || 'Unknown';
                const truncatedNextTitle = nextTitle.length > 25 ? nextTitle.substring(0, 23) + '...' : nextTitle;
                embed.addFields({ name: 'Up Next', value: `\`${truncatedNextTitle}\``, inline: true });
            }

            let footerText = `${artistName}`;
            if (metadata?.releaseDate) {
                const dateStr = metadata.releaseDate.toISOString().split('T')[0];
                footerText += `  •  ${dateStr}`;
            }

            embed.setFooter({ text: footerText, iconURL: footerIcon })
                .setColor(color);

            if (activeFilters) {
                embed.addFields({ name: 'Active Effects', value: `\`${activeFilters}\``, inline: false });
            }

            if (art) embed.setThumbnail(art);

            const npMsg = await textChannel?.send({ embeds: [embed] }).catch(err => {
                console.log(`[player] failed to send now playing: ${err.message}`);
                return null;
            });

            if (npMsg) {
                const s = playerStates.get(guildId);
                if (s) s.npMessage = npMsg;
            }
        };

        applyColorAndSend();

        if (voiceChannel?.permissionsFor(client.user)?.has(SET_VOICE_STATUS)) {
            const title = track.title || 'Unknown Track';
            const truncatedName = title.length > 30 ? title.slice(0, 30) + '...' : title;
            const vinylEmoji = getEmoji('vinyl', voiceChannel.guild, textChannel);
            const statusPrefix = vinylEmoji ? `${vinylEmoji} ` : '';
            setVoiceChannelStatus(voiceChannel, `${statusPrefix}Now Playing: ${truncatedName}`).catch(() => { });
        }
    });
}
//
module.exports = { registerTrackStart };
// contributors: @relentiousdragon