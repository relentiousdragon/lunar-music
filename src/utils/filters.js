const { EmbedBuilder } = require('discord.js');
const manager = require('../manager');
const { playerStates } = require('../state');
const { getFormattedDuration } = require('./format');
//
function getActiveFiltersString(state) {
    if (!state) return '';
    const active = [];
    if (state.nightcore) active.push('Nightcore');
    if (state.vaporwave) active.push('Vaporwave');
    if (state.tremolo) active.push('Tremolo');
    if (state.vibrato) active.push('Vibrato');
    if (state.rotation) active.push('Rotation');
    if (state.lowpass) active.push('LowPass');
    if (state.echo) active.push('Echo');
    if (state.karaoke) active.push('Karaoke');
    return active.length ? active.join(', ') : '';
}

async function updateNowPlayingEmbed(guildId) {
    const state = playerStates.get(guildId);
    if (!state || !state.npMessage || !state.npMessage.embeds?.[0]) return;

    try {
        const activeFilters = getActiveFiltersString(state);
        const embed = EmbedBuilder.from(state.npMessage.embeds[0]);

        const player = manager.players.get(guildId);
        if (player && player.current) {
            const track = player.current;
            const duration = getFormattedDuration(track);

            const filteredFields = state.npMessage.embeds[0].fields.filter(
                f => f.name !== 'Lyrics' && f.name !== 'Active Effects' && f.name !== 'Duration'
            );
            const newFields = [...filteredFields];
            newFields.push({ name: 'Duration', value: `\`${duration}\``, inline: true });

            if (activeFilters) {
                newFields.push({ name: 'Active Effects', value: `\`${activeFilters}\``, inline: false });
            }

            if (!state.nightcore && !state.vaporwave && state.lyrics && state.lastLyrics) {
                newFields.push({ name: 'Lyrics', value: `\`\`\`${state.lastLyrics.slice(0, 1000)}\`\`\`` });
            }

            embed.setFields(newFields);
            await state.npMessage.edit({ embeds: [embed] });
        }
    } catch (err) {
        if (err.code === 10008 || err.message?.includes('Unknown Message')) {
            state.npMessage = null;
        } else {
            console.log(`[player] failed to update now playing embed: ${err.message}`);
        }
    }
}
//
module.exports = { getActiveFiltersString, updateNowPlayingEmbed };
// contributors: @relentiousdragon