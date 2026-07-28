const client = require('../client');
const manager = require('../manager');
const { playerStates, releaseLyricsSlot } = require('../state');
const { formatTime } = require('../utils/format');
const { createEmbed } = require('../utils/embeds');
const { setVoiceChannelStatus } = require('../utils/voice');
const { EmbedBuilder } = require('discord.js');
const { getEmoji } = require('../utils/emojis');
const { getBotFooter } = require('../utils/branding');

const SET_VOICE_STATUS = BigInt(1) << BigInt(48);

const BREAK_STATUSES = [
    'taking a short break',
    'quick breather',
    'back in a sec',
    'stretching the cables',
    'refilling the playlist',
    'tuning up',
    'brief intermission',
    'one moment',
];
//
async function sendSessionSummary(guildId) {
    const state = playerStates.get(guildId);
    if (!state || !state.sessionTracks || state.sessionTracks === 0) return;

    const textChannel = client.channels.cache.get(state.textChannelId);
    if (!textChannel) return;

    const guild = textChannel.guild;
    const summaryEmbed = new EmbedBuilder()
        .setTitle(`${getEmoji('cd', guild, textChannel)} Session Summary`)
        .setDescription('Your listening session has ended. Here\'s a quick recap:')
        .addFields(
            { name: 'Songs Played', value: `\`${state.sessionTracks}\``, inline: true },
            { name: 'Total Time', value: `\`${formatTime(state.sessionDuration)}\``, inline: true }
        )
        .setColor('#6A5ACD')
        .setTimestamp()
        .setFooter(getBotFooter());

    await textChannel.send({ embeds: [summaryEmbed] }).catch(() => { });

    state.sessionTracks = 0;
    state.sessionDuration = 0;
}

function registerTrackEnd() {
    manager.on('trackEnd', async (player, track, reason) => {
        const guildId = player.guildId;
        const state = playerStates.get(guildId) || {};
        releaseLyricsSlot(guildId);

        if (reason && reason !== 'replaced') {
            const playedTime = Math.max(0, (state.manualPos || player.position || 0) - (state.lastSeekTime || 0));
            state.playbackTimeSinceBreak = (state.playbackTimeSinceBreak || 0) + playedTime;
            state.playbackTimeSinceBreak += playedTime;
            state.timestamp = 0;

            if (state.playbackTimeSinceBreak >= 3600000 && !state.isBreaking) {
                state.isBreaking = true;
                const voiceChannel = client.channels.cache.get(player.voiceChannelId);
                const textChannel = client.channels.cache.get(player.textChannelId);

                if (voiceChannel?.permissionsFor(client.user)?.has(SET_VOICE_STATUS)) {
                    const randomStatus = BREAK_STATUSES[Math.floor(Math.random() * BREAK_STATUSES.length)];
                    setVoiceChannelStatus(voiceChannel, randomStatus).catch(() => { });
                }

                const savedQueue = player.queue.tracks.map(t => ({ ...t }));
                const currentTrack = player.current;

                textChannel?.send({
                    embeds: [createEmbed(
                        `${getEmoji('star', textChannel.guild, textChannel)} Taking a break`,
                        'Taking a quick 60-second break...',
                        '#6A5ACD'
                    )]
                });

                player.destroy();

                setTimeout(async () => {
                    try {
                        const vc = client.channels.cache.get(player.voiceChannelId);
                        const newPlayer = manager.players.create({
                            guildId,
                            voiceChannelId: vc?.id || player.voiceChannelId,
                            textChannelId: textChannel?.id || player.textChannelId,
                            volume: 100
                        });
                        await newPlayer.connect({ selfDeaf: true });

                        if (savedQueue.length > 0) {
                            newPlayer.queue.add(savedQueue);
                        }
                        if (currentTrack) {
                            await newPlayer.play();
                        }

                        state.playbackTimeSinceBreak = 0;
                        state.isBreaking = false;

                        if (voiceChannel?.permissionsFor(client.user)?.has(SET_VOICE_STATUS)) {
                            setVoiceChannelStatus(voiceChannel, '').catch(() => { });
                        }
                    } catch (error) {
                        console.log(`[player] break recovery failed: ${error.message}`);
                        state.isBreaking = false;
                        if (voiceChannel?.permissionsFor(client.user)?.has(SET_VOICE_STATUS)) {
                            setVoiceChannelStatus(voiceChannel, '').catch(() => { });
                        }
                        textChannel?.send({
                            embeds: [createEmbed(
                                `${getEmoji('xmark', textChannel.guild, textChannel)} Recovery Failed`,
                                'Failed to automatically resume after connection break.',
                                '#FF0000'
                            )]
                        });
                    }
                }, 60000);
            }
        }
    });
}
//
module.exports = { registerTrackEnd, sendSessionSummary };
// contributors: @relentiousdragon