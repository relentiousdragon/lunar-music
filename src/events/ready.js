const { ActivityType, Events } = require('discord.js');
const client = require('../client');
const manager = require('../manager');
const { playerStates, stallHistory } = require('../state');
const { createEmbed } = require('../utils/embeds');
const { setVoiceChannelStatus } = require('../utils/voice');
const { getEmoji } = require('../utils/emojis');
const { getMoonlinkPlaybackPosition, getDirectNodePlaybackPosition, refreshDirectNodePlayback, canSynchronizeWatchdog } = require('../utils/playbackPosition');
const { registerSlashCommands } = require('./interactionCreate');

const statuses = [
    { type: ActivityType.Listening, text: 'ln.help' },
    { type: ActivityType.Listening, text: 'some bangers rn' },
    { type: ActivityType.Playing, text: 'music for the vibes' },
    { type: ActivityType.Watching, text: 'the queue grow' },
    { type: ActivityType.Listening, text: 'your playlists' },
    { type: ActivityType.Playing, text: 'songs on repeat' },
    { type: ActivityType.Watching, text: 'who skips first' },
    { type: ActivityType.Listening, text: 'something good' },
    { type: ActivityType.Playing, text: 'that one song again' },
    { type: ActivityType.Watching, text: 'the vibe check' },
    { type: ActivityType.Listening, text: 'late night tunes' },
    { type: ActivityType.Playing, text: 'dj for the server' },
    { type: ActivityType.Watching, text: 'everyone argue over songs' },
    { type: ActivityType.Listening, text: 'whatever you throw at me' },
    { type: ActivityType.Playing, text: 'the aux cord' },
];

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
function registerReadyEvent() {
    client.once(Events.ClientReady, async () => {
        console.log(`[bot] logged in as ${client.user.tag}`);

        try {
            await registerSlashCommands();
        } catch (err) {
            console.log(`[commands] slash registration failed: ${err.message}`);
        }

        console.log('[manager] initialized moonlink manager');

        const updatePresence = () => {
            const { type, text } = statuses[Math.floor(Math.random() * statuses.length)];
            try {
                client.user.setPresence({
                    activities: [{ name: text, type }],
                    status: 'idle'
                });
            } catch (error) {
                console.log(`[bot] failed to set presence: ${error.message}`);
            }
        };

        updatePresence();
        setInterval(updatePresence, 300000);
        startPlaybackWatchdog();
    });
}
//
function startPlaybackWatchdog() {
    const { EmbedBuilder } = require('discord.js');
    const { getActiveFiltersString } = require('../utils/filters');

    setInterval(async () => {
        for (const [guildId, lastState] of playerStates.entries()) {
            const player = manager.players.get(guildId);
            if (!player || !player.playing || player.paused) continue;

            const now = Date.now();

            let nodePosition = getMoonlinkPlaybackPosition(player, now);
            if (nodePosition === null) {
                void refreshDirectNodePlayback(player, lastState, now);
                nodePosition = getDirectNodePlaybackPosition(player, lastState, now);
            }
            let currentPos;
            if (nodePosition !== null && canSynchronizeWatchdog(lastState.manualPos || 0, nodePosition)) {
                lastState.manualPos = nodePosition;
                lastState.lastWatchdogUpdate = now;
                currentPos = nodePosition;
            } else {
                if (!lastState.manualPos) lastState.manualPos = 0;
                if (!lastState.lastWatchdogUpdate) lastState.lastWatchdogUpdate = now;
                const delta = now - lastState.lastWatchdogUpdate;
                lastState.manualPos += delta;
                lastState.lastWatchdogUpdate = now;
                currentPos = lastState.manualPos;
            }

            if (lastState.lyrics && lastState.npMessage) {
                const currentMillis = currentPos;
                if (currentMillis >= (lastState.nextLyricUpdate || 0)) {
                    let currentIndex = -1;
                    for (let i = 0; i < lastState.lyrics.length; i++) {
                        if (lastState.lyrics[i].time <= currentMillis) {
                            currentIndex = i;
                        } else {
                            break;
                        }
                    }

                    if (currentIndex !== -1) {
                        const activeLines = lastState.lyrics.slice(currentIndex);
                        let chunk = [];
                        let duration = 0;
                        let nextUpdateTime = 0;
                        const startTime = activeLines[0].time;

                        for (let i = 0; i < activeLines.length; i++) {
                            const line = activeLines[i];
                            const nextLine = activeLines[i + 1];

                            chunk.push(line.text);

                            if (nextLine) {
                                duration = nextLine.time - startTime;
                                if (duration >= 5000) {
                                    nextUpdateTime = nextLine.time;
                                    break;
                                }
                            } else {
                                nextUpdateTime = line.time + 30000;
                                break;
                            }
                        }

                        const text = chunk.join('\n');

                        if (lastState.nightcore || lastState.vaporwave) {
                            if (lastState.npMessage?.embeds?.[0]) {
                                const embed = EmbedBuilder.from(lastState.npMessage.embeds[0]);
                                if (lastState.npMessage.embeds[0].fields.some(f => f.name === 'Lyrics')) {
                                    const filteredFields = lastState.npMessage.embeds[0].fields.filter(f => f.name !== 'Lyrics');
                                    embed.setFields(filteredFields);
                                    lastState.npMessage.edit({ embeds: [embed] }).catch(() => { });
                                }
                            }
                            continue;
                        }

                        if (text && text !== lastState.lastLyrics) {
                            lastState.lastLyrics = text;
                            lastState.nextLyricUpdate = nextUpdateTime;

                            if (lastState.npMessage?.embeds?.[0]) {
                                const activeFilters = getActiveFiltersString(lastState);
                                const embed = EmbedBuilder.from(lastState.npMessage.embeds[0]);
                                const filteredFields = lastState.npMessage.embeds[0].fields.filter(
                                    f => f.name !== 'Lyrics' && f.name !== 'Active Effects'
                                );

                                const newFields = [...filteredFields];
                                if (activeFilters) {
                                    newFields.push({ name: 'Active Effects', value: `\`${activeFilters}\``, inline: false });
                                }
                                newFields.push({ name: 'Lyrics', value: `\`\`\`${text.slice(0, 1000)}\`\`\`` });

                                embed.setFields(newFields);

                                lastState.npMessage.edit({ embeds: [embed] }).catch(err => {
                                    if (err.code === 10008 || err.message?.includes('Unknown Message')) {
                                        lastState.npMessage = null;
                                    }
                                });
                            }
                        }
                    }
                }
            }

            const positionDelta = Math.abs(currentPos - (lastState.pos || 0));
            const isPositionStuck = positionDelta < 1000;

            if (isPositionStuck && lastState.timestamp && (now - lastState.timestamp) > 45000) {
                if (now - lastState.timestamp < 10000) continue;
                console.log(`[watchdog] player stuck in ${guildId} at ${currentPos}ms`);
                await triggerStallRecovery(guildId, player, lastState);
            } else if (!isPositionStuck) {
                lastState.pos = currentPos;
                lastState.timestamp = now;
            }
        }
    }, 500);
}

async function triggerStallRecovery(guildId, player, lastState) {
    if (lastState.isBreaking) return;

    const now = Date.now();
    const stalls = stallHistory.get(guildId) || [];
    stalls.push(now);
    const recentStalls = stalls.filter(t => now - t < 300000);
    stallHistory.set(guildId, recentStalls);

    const textChannel = client.channels.cache.get(player.textChannelId);

    if (recentStalls.length >= 2) {
        console.log(`[watchdog] multiple stalls in ${guildId}, taking 60s recovery break`);
        lastState.isBreaking = true;

        const voiceChannel = client.channels.cache.get(player.voiceChannelId);
        const savedQueue = player.queue.tracks.map(t => ({ ...t }));
        const currentTrack = player.current;
        const pos = player.position;

        textChannel?.send({
            embeds: [createEmbed(
                `${getEmoji('xmark')} Playback Error`,
                'Multiple stalls detected. Recovering in 60 seconds, please wait...',
                '#FF0000'
            )]
        });

        const SET_VOICE_STATUS = BigInt(1) << BigInt(48);
        if (voiceChannel?.permissionsFor(client.user)?.has(SET_VOICE_STATUS)) {
            const randomStatus = BREAK_STATUSES[Math.floor(Math.random() * BREAK_STATUSES.length)];
            setVoiceChannelStatus(voiceChannel, randomStatus).catch(() => { });
        }

        player.destroy();

        const attemptRecovery = async () => {
            try {
                const vc = client.channels.cache.get(player.voiceChannelId);
                const newPlayer = manager.players.create({
                    guildId,
                    voiceChannelId: vc?.id || player.voiceChannelId,
                    textChannelId: textChannel?.id || player.textChannelId,
                    volume: 100
                });
                await newPlayer.connect({ selfDeaf: true });

                if (currentTrack) {
                    newPlayer.queue.add(currentTrack);
                    await newPlayer.play({ position: pos });
                }
                if (savedQueue.length > 0) {
                    newPlayer.queue.add(savedQueue);
                }

                lastState.isBreaking = false;

                if (vc?.permissionsFor(client.user)?.has(SET_VOICE_STATUS)) {
                    setVoiceChannelStatus(vc, '').catch(() => { });
                }
                console.log(`[watchdog] recovered guild ${guildId}`);
            } catch (err) {
                console.log(`[watchdog] recovery failed for ${guildId}: ${err.message}, retrying in 30s`);
                setTimeout(attemptRecovery, 30000);
            }
        };

        setTimeout(attemptRecovery, 60000);
    } else {
        const isEarlyStall = (lastState.manualPos || 0) < 30000;
        const canRestart = isEarlyStall && !lastState.recoveryRestarted;

        if (canRestart) {
            console.log(`[watchdog] early stall in ${guildId} at ${lastState.manualPos}ms, restarting track`);
            lastState.recoveryRestarted = true;
            lastState.manualPos = 0;
            lastState.pos = 0;
            lastState.timestamp = Date.now();

            player.seek(0).catch(err => {
                console.log(`[watchdog] restart failed in ${guildId}: ${err.message}`);
                player.skip().catch(() => { });
            });
        } else {
            if (!isEarlyStall) {
                textChannel?.send({
                    embeds: [createEmbed(
                        `${getEmoji('xmark')} Playback Stalled`,
                        'Detected a frozen track, skipping..',
                        '#FFA500'
                    )]
                });
            }

            player.skip().catch(err => {
                console.log(`[watchdog] skip failed in ${guildId}: ${err.message}`);
                player.destroy();
            });
        }
    }
}
//
module.exports = { registerReadyEvent, BREAK_STATUSES, triggerStallRecovery };
// contributors: @relentiousdragon
