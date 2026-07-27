const manager = require('../manager');
const { playerStates } = require('../state');
const { createEmbed } = require('../utils/embeds');
const { updateNowPlayingEmbed } = require('../utils/filters');
const { getEmoji } = require('../utils/emojis');

async function applyFilterToPlayer(player, enabled, applyFn, clearFn) {
    if (enabled) applyFn(player);
    else clearFn(player);
    await player.filters.apply();
}
//
async function executeFilter(message, filterName, applyFn, clearFn) {
    const player = manager.players.get(message.guild.id);
    if (!player) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', message.guild, message.channel)} Nothing Playing`, 'Start something first!', '#FF0000')] });
    }

    if (filterName === 'echo' && !player.node?.isNodeLink) {
        return message.channel.send({
            embeds: [createEmbed(
                `${getEmoji('xmark', message.guild, message.channel)} Filter Unavailable`,
                'Echo is unavailable because the connected node is standard Lavalink. Use a NodeLink node for this filter.',
                '#FFA500'
            )]
        });
    }

    const state = playerStates.get(message.guild.id) || {};
    state[filterName] = !state[filterName];

    if (filterName === 'nightcore' && state.nightcore && state.vaporwave) {
        state.vaporwave = false;
    }
    if (filterName === 'vaporwave' && state.vaporwave && state.nightcore) {
        state.nightcore = false;
    }

    playerStates.set(message.guild.id, state);

    await applyFilterToPlayer(player, state[filterName], applyFn, clearFn);
    await updateNowPlayingEmbed(message.guild.id);

    const displayName = filterName.charAt(0).toUpperCase() + filterName.slice(1);
    const enabled = state[filterName];

    message.channel.send({
        embeds: [createEmbed(
            `${getEmoji('right', message.guild, message.channel)} ${displayName} ${enabled ? 'Enabled' : 'Disabled'}`,
            `${displayName} filter has been **${enabled ? 'enabled' : 'disabled'}**`,
            enabled ? '#00FF00' : '#FF0000'
        )]
    });
}

const filters = {
    nightcore: {
        execute: (msg) => executeFilter(msg, 'nightcore',
            p => p.filters.setTimescale({ speed: 1.15, pitch: 1.15, rate: 1.0 }),
            p => p.filters.setTimescale(null)
        ),
        aliases: ['nc']
    },
    vaporwave: {
        execute: (msg) => executeFilter(msg, 'vaporwave',
            p => p.filters.setTimescale({ speed: 0.85, pitch: 0.85, rate: 1.0 }),
            p => p.filters.setTimescale(null)
        ),
        aliases: ['vw']
    },
    tremolo: {
        execute: (msg) => executeFilter(msg, 'tremolo',
            p => p.filters.setTremolo({ frequency: 4.0, depth: 0.75 }),
            p => p.filters.setTremolo(null)
        ),
        aliases: []
    },
    vibrato: {
        execute: (msg) => executeFilter(msg, 'vibrato',
            p => p.filters.setVibrato({ frequency: 4.0, depth: 0.75 }),
            p => p.filters.setVibrato(null)
        ),
        aliases: []
    },
    rotation: {
        execute: (msg) => executeFilter(msg, 'rotation',
            p => p.filters.setRotation({ rotationHz: 0.2 }),
            p => p.filters.setRotation(null)
        ),
        aliases: []
    },
    lowpass: {
        execute: (msg) => executeFilter(msg, 'lowpass',
            p => p.filters.setLowPass({ smoothing: 20.0 }),
            p => p.filters.setLowPass(null)
        ),
        aliases: []
    },
    echo: {
        execute: (msg) => executeFilter(msg, 'echo',
            p => p.filters.setEcho({ echoLength: 0.5, decay: 0.5 }),
            p => p.filters.setEcho(null)
        ),
        aliases: []
    },
    karaoke: {
        execute: (msg) => executeFilter(msg, 'karaoke',
            p => p.filters.setKaraoke({ level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 }),
            p => p.filters.setKaraoke(null)
        ),
        aliases: ['kr']
    }
};
//
module.exports = filters;
Object.defineProperty(module.exports, 'applyFilterToPlayer', { value: applyFilterToPlayer, enumerable: false });
// contributors: @relentiousdragon