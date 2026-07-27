const client = require('../client');
const { createEmbed, handleError } = require('../utils/embeds');
const { getEmoji } = require('../utils/emojis');

const commands = new Map();

function register(name, handler) {
    commands.set(name, handler);
    if (handler.aliases) {
        handler.aliases.forEach(alias => commands.set(alias, handler));
    }
}

const play = require('../commands/play');
register('play', play);

const queue = require('../commands/queue');
register('queue', queue);

const skipCommands = require('../commands/skip');
register('skip', skipCommands.skip);
register('previous', skipCommands.previous);
register('back', skipCommands.back);

const playbackCommands = require('../commands/playback');
register('pause', playbackCommands.pause);
register('resume', playbackCommands.resume);
register('stop', playbackCommands.stop);
register('seek', playbackCommands.seek);
register('loop', playbackCommands.loop);
register('clear', playbackCommands.clear);
register('restart', playbackCommands.restart);

// filters
const filterCommands = require('../commands/filters');
for (const [name, handler] of Object.entries(filterCommands)) {
    register(name, handler);
}

// stats
const statsCommands = require('../commands/stats');
register('top', statsCommands.top);
register('global', statsCommands.global);

// other
const help = require('../commands/help');
register('help', help);

const system = require('../commands/system');
register('sr', system);

const credits = require('../commands/credits');
register('credits', credits);
const { checkRateLimit } = require('../utils/rateLimit');
//
function getPrefixes() {
    const envPrefixes = process.env.BOT_PREFIXES;
    if (envPrefixes) {
        return envPrefixes.split(',').map(p => p.trim()).filter(Boolean);
    }
    return ['ln.', 'l.'];
}

function registerMessageCreate() {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const prefixes = getPrefixes();
        let usedPrefix = null;

        for (const p of prefixes) {
            if (message.content.toLowerCase().startsWith(p.toLowerCase())) {
                usedPrefix = p;
                break;
            }
        }

        if (!usedPrefix) return;

        const args = message.content.slice(usedPrefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const handler = commands.get(command);

        if (!handler) {
            const defaultPrefixes = ['ln.', 'l.'];
            if (defaultPrefixes.some(dp => usedPrefix.toLowerCase() === dp)) {
                message.channel.send({
                    embeds: [createEmbed(
                        `${getEmoji('star', message.guild, message.channel)} Unknown Command`,
                        `Use \`${usedPrefix}help\` for available commands`,
                        '#FFA500'
                    )]
                });
            }
            return;
        }

        try {
            const rateLimitCommand = command === 'play' ? 'play'
                : command === 'skip' ? 'skip'
                    : command === 'seek' ? 'seek'
                        : Object.prototype.hasOwnProperty.call(require('../commands/filters'), command) ? 'filter' : null;
            const retryAfter = checkRateLimit(message, rateLimitCommand);
            if (retryAfter) {
                return message.channel.send({ embeds: [createEmbed(
                    `${getEmoji('xmark', message.guild, message.channel)} Slow Down`,
                    `Please wait **${Math.ceil(retryAfter / 1000)}s** before using this command again.`,
                    '#FFA500'
                )] });
            }
            await handler.execute(message, args);
        } catch (error) {
            handleError(message, error);
        }
    });
}
//
module.exports = { registerMessageCreate, commands };
// contributors: @relentiousdragon
