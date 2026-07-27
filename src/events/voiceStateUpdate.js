const client = require('../client');
const manager = require('../manager');
const { voiceTimeouts } = require('../state');
const { createEmbed } = require('../utils/embeds');
const { getEmoji } = require('../utils/emojis');
//
function registerVoiceStateUpdate() {
    client.on('voiceStateUpdate', async (oldState, newState) => {
        if (oldState.channelId === newState.channelId) return;

        const guildId = newState.guild.id;
        const botMember = newState.guild.members.me;

        if (voiceTimeouts.has(guildId)) {
            clearTimeout(voiceTimeouts.get(guildId));
            voiceTimeouts.delete(guildId);
        }

        if (!botMember?.voice.channel) return;

        const vc = botMember.voice.channel;
        const humanMembers = vc.members.filter(m => !m.user.bot);

        if (humanMembers.size === 0) {
            const timeout = setTimeout(async () => {
                const player = manager.players.get(guildId);

                try {
                    if (player) {
                        const textChannel = client.channels.cache.get(player.textChannelId);
                        player.destroy();
                        textChannel?.send({
                            embeds: [
                                createEmbed(
                                    `${getEmoji('xmark', textChannel?.guild, textChannel)} Inactive Channel`,
                                    'Left voice channel due to inactivity',
                                    '#FFA500'
                                )
                            ]
                        });
                    }
                } catch (error) {
                    console.log(`[voice] inactivity leave error: ${error.message}`);
                }

                voiceTimeouts.delete(guildId);
            }, 60000);

            voiceTimeouts.set(guildId, timeout);
        }
    });
}
//
module.exports = { registerVoiceStateUpdate };
// contributors: @relentiousdragon