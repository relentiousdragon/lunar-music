const { Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const client = require('../client');
const { commands } = require('./messageCreate');
const { handleError } = require('../utils/embeds');
const { checkRateLimit } = require('../utils/rateLimit');
const { searchWithRetry } = require('../utils/search');
const { getDefaultSearchSource } = require('../utils/guildSettings');
const { resolveSourceName } = require('../utils/capabilities');
const { getCachedSuggestions, cacheSuggestions, canSearchAutocomplete } = require('../utils/autocompleteCache');

const definitions = [
    ['play', 'Play a song or playlist', b => b
        .addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('source').setDescription('Search source').addChoices(
            { name: 'YouTube', value: 'youtube' }, { name: 'YouTube Music', value: 'youtubemusic' },
            { name: 'SoundCloud', value: 'soundcloud' }, { name: 'Spotify', value: 'spotify' },
            { name: 'Deezer', value: 'deezer' }, { name: 'Apple Music', value: 'applemusic' }, { name: 'Tidal', value: 'tidal' }
        ))],
    ['source', 'View or set this server’s default search source', b => b.addStringOption(o => o.setName('platform').setDescription('Use auto to reset').addChoices(
        { name: 'Automatic fallback order', value: 'auto' }, { name: 'YouTube', value: 'youtube' }, { name: 'YouTube Music', value: 'youtubemusic' },
        { name: 'SoundCloud', value: 'soundcloud' }, { name: 'Spotify', value: 'spotify' }, { name: 'Deezer', value: 'deezer' }, { name: 'Apple Music', value: 'applemusic' }, { name: 'Tidal', value: 'tidal' }
    ))],
    ['node', 'Show node diagnostics (developers only)'],
    ['queue', 'Show the current queue', b => b.addIntegerOption(o => o.setName('page').setDescription('Queue page').setMinValue(1))],
    ['seek', 'Jump to a position in the current track', b => b.addStringOption(o => o.setName('position').setDescription('For example 1:30').setRequired(true))],
    ['loop', 'Set or cycle the loop mode', b => b.addStringOption(o => o.setName('mode').setDescription('track, queue, or off').addChoices({ name: 'track', value: 'track' }, { name: 'queue', value: 'queue' }, { name: 'off', value: 'off' }))],
    ['help', 'Show the available commands'],
    ['credits', 'Show project credits and repository'],
    ['skip', 'Skip the current track'], ['previous', 'Play the previous track'], ['back', 'Play the previous track'],
    ['pause', 'Pause playback'], ['resume', 'Resume playback'], ['stop', 'Stop playback'], ['clear', 'Clear the queue'],
    ['restart', 'Restart the player'], ['top', 'Show this server’s top tracks'], ['global', 'Show global top tracks'],
    ['nightcore', 'Toggle nightcore'], ['vaporwave', 'Toggle vaporwave'], ['tremolo', 'Toggle tremolo'],
    ['vibrato', 'Toggle vibrato'], ['rotation', 'Toggle rotation'], ['lowpass', 'Toggle low-pass'],
    ['echo', 'Toggle echo'], ['karaoke', 'Toggle karaoke']
].map(([name, description, addOptions]) => {
    const builder = new SlashCommandBuilder().setName(name).setDescription(description);
    return (addOptions ? addOptions(builder) : builder).toJSON();
});
//
function toMessage(interaction) {
    const sent = [];
    const channel = {
        id: interaction.channelId,
        guild: interaction.guild,
        send: async payload => {
            const result = interaction.replied || interaction.deferred
                ? await interaction.followUp(payload)
                : await interaction.reply({ ...payload, fetchReply: true });
            sent.push(result);
            return result;
        },
        createMessageCollector: (...args) => interaction.channel?.createMessageCollector(...args)
    };
    return {
        guild: interaction.guild,
        channel,
        member: interaction.member,
        author: interaction.user,
        user: interaction.user,
        content: '',
        reply: channel.send,
        delete: async () => { },
        slash: true,
        sent
    };
}

async function registerSlashCommands() {
    if (!process.env.DISCORD_TOKEN || !client.user) return;
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const route = process.env.DISCORD_GUILD_ID
        ? Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID)
        : Routes.applicationCommands(client.user.id);
    await rest.put(route, { body: definitions });
    console.log(`[commands] registered ${definitions.length} slash commands`);
}

function registerInteractionCreate() {
    client.on(Events.InteractionCreate, async interaction => {
        if (interaction.isAutocomplete()) {
            if (interaction.commandName !== 'play') return interaction.respond([]);
            const query = interaction.options.getFocused().trim();
            if (query.length < 2 || /^https?:\/\//i.test(query)) return interaction.respond([]);
            try {
                const selectedSource = interaction.options.getString('source') || getDefaultSearchSource(interaction.guildId) || 'soundcloud';
                const source = resolveSourceName(selectedSource);
                const cached = getCachedSuggestions(source, query);
                if (cached) return interaction.respond(cached);
                if (!canSearchAutocomplete(interaction.user.id)) return interaction.respond([]);
                const search = searchWithRetry(null, query.slice(0, 100), interaction.user, source)
                    .then(result => (result.tracks || []).slice(0, 10).map(track => ({
                        name: `${track.author || 'Unknown'} - ${track.title}`.slice(0, 100),
                        value: `${track.author || ''} ${track.title}`.trim().slice(0, 100)
                    })));
                const suggestions = await Promise.race([
                    search,
                    new Promise(resolve => setTimeout(() => resolve({ tracks: [] }), 2300))
                ]);
                if (Array.isArray(suggestions)) {
                    cacheSuggestions(source, query, suggestions);
                    return interaction.respond(suggestions);
                }
                search.then(results => cacheSuggestions(source, query, results)).catch(() => { });
                return interaction.respond([]);
            } catch {
                return interaction.respond([]);
            }
        }
        if (!interaction.isChatInputCommand()) return;
        const handler = commands.get(interaction.commandName);
        if (!handler) return interaction.reply({ content: 'Unknown command.', ephemeral: true });
        const args = [];
        if (interaction.commandName === 'play') {
            args.push(interaction.options.getString('query'));
            const source = interaction.options.getString('source');
            const sourceFlags = { youtube: '--yt', youtubemusic: '--ytm', soundcloud: '--sc', spotify: '--sp', deezer: '--dz', applemusic: '--am', tidal: '--td' };
            if (sourceFlags[source]) args.push(sourceFlags[source]);
        }
        if (interaction.commandName === 'source') {
            const platform = interaction.options.getString('platform');
            if (platform) args.push(platform);
        }
        if (interaction.commandName === 'queue') args.push(String(interaction.options.getInteger('page') || 1));
        if (interaction.commandName === 'seek') args.push(interaction.options.getString('position'));
        if (interaction.commandName === 'loop') {
            const mode = interaction.options.getString('mode');
            if (mode) args.push(mode);
        }
        try {
            const rateLimitCommand = interaction.commandName === 'play' ? 'play'
                : interaction.commandName === 'skip' ? 'skip'
                    : interaction.commandName === 'seek' ? 'seek'
                        : ['nightcore', 'vaporwave', 'tremolo', 'vibrato', 'rotation', 'lowpass', 'echo', 'karaoke'].includes(interaction.commandName) ? 'filter' : null;
            const retryAfter = checkRateLimit(toMessage(interaction), rateLimitCommand);
            if (retryAfter) {
                return interaction.reply({ content: `Please wait ${Math.ceil(retryAfter / 1000)}s before using this command again.`, ephemeral: true });
            }
            await handler.execute(toMessage(interaction), args);
        } catch (error) {
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Command failed.', ephemeral: true });
            handleError(toMessage(interaction), error);
        }
    });
}
//
module.exports = { registerInteractionCreate, registerSlashCommands };
// contributors: @relentiousdragon
