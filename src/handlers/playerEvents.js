const client = require('../client');
const manager = require('../manager');
const { playerStates, activeQueues, releaseLyricsSlot } = require('../state');
const { createEmbed } = require('../utils/embeds');
const { setVoiceChannelStatus } = require('../utils/voice');
const { triggerStallRecovery } = require('../events/ready');
const { getEmoji } = require('../utils/emojis');

const SET_VOICE_STATUS = BigInt(1) << BigInt(48);
//
function clearQueueTimeout(guildId) {
    if (activeQueues.has(guildId)) {
        clearTimeout(activeQueues.get(guildId));
        activeQueues.delete(guildId);
    }
}

function setQueueTimeout(guildId, delay) {
    clearQueueTimeout(guildId);
    const { sendSessionSummary } = require('./trackEnd');

    const timeout = setTimeout(async () => {
        try {
            const player = manager.players.get(guildId);
            if (player) {
                const textChannel = client.channels.cache.get(player.textChannelId);
                await sendSessionSummary(guildId);
                player.destroy();
                textChannel?.send({
                    embeds: [
                        createEmbed(
                            `${getEmoji('xmark', textChannel?.guild, textChannel)} Inactive Channel`,
                            'No music has been played for a while. Leaving voice channel.',
                            '#FFA500'
                        )
                    ]
                });
            }
        } catch (err) {
            console.log(`[player] timeout leave error for ${guildId}: ${err.message}`);
        } finally {
            activeQueues.delete(guildId);
        }
    }, delay);

    activeQueues.set(guildId, timeout);
}

function registerPlayerEvents() {
    manager.on('queueEnd', async (player) => {
        const guildId = player.guildId;
        const pState = playerStates.get(guildId);
        if (pState?.isBreaking) return;

        const voiceChannel = client.channels.cache.get(player.voiceChannelId);
        if (voiceChannel?.permissionsFor(client.user)?.has(SET_VOICE_STATUS)) {
            setVoiceChannelStatus(voiceChannel, '');
        }
        setQueueTimeout(guildId, 300000);
    });

    manager.on('trackStuck', async (player, track) => {
        console.log(`[player] track stuck in ${player.guildId}: ${track?.title}`);
        const guildId = player.guildId;
        let state = playerStates.get(guildId);
        if (!state) {
            state = { nightcore: false };
            playerStates.set(guildId, state);
        }
        await triggerStallRecovery(guildId, player, state);
    });

    manager.on('playerDestroy', (player) => {
        const state = playerStates.get(player.guildId);
        releaseLyricsSlot(player.guildId);
        if (!state?.isBreaking) {
            playerStates.delete(player.guildId);
        }
    });

    manager.on('playerDisconnected', (player) => {
        const guildId = player.guildId;
        releaseLyricsSlot(guildId);
        const stateBreaking = playerStates.get(guildId)?.isBreaking;
        if (!stateBreaking) {
            playerStates.delete(guildId);
        }
    });
}
//
module.exports = { registerPlayerEvents, clearQueueTimeout, setQueueTimeout };
// contributors: @relentiousdragon