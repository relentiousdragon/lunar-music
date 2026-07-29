const { Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const client = require('../client');
const { commands } = require('./messageCreate');
const { handleError } = require('../utils/embeds');
const { checkRateLimit } = require('../utils/rateLimit');
const { searchWithRetry } = require('../utils/search');
const { getUsableDefaultSearchSource } = require('../utils/guildSettings');
const { capabilities, resolveSourceName } = require('../utils/capabilities');
const { getCachedSuggestions, cacheSuggestions, canSearchAutocomplete, createSelection, consumeSelection } = require('../utils/autocompleteCache');
const { getGlobalTopTracks } = require('../utils/stats');

const SOURCE_CHOICES = [
    ['YouTube', 'youtube'], ['YouTube Music', 'youtubemusic'], ['SoundCloud', 'soundcloud'],
    ['Spotify', 'spotify'], ['Deezer', 'deezer'], ['Apple Music', 'applemusic'], ['Tidal', 'tidal']
];
const SOURCE_CAPABILITY_ALIASES = {
    youtube: ['youtube', 'ytsearch'],
    youtubemusic: ['youtubemusic', 'ytmsearch'],
    soundcloud: ['soundcloud', 'scsearch'],
    spotify: ['spotify', 'spsearch'],
    deezer: ['deezer', 'dzsearch'],
    applemusic: ['applemusic', 'amsearch'],
    tidal: ['tidal', 'tdsearch']
};

function getSupportedSourceChoices() {
    if (capabilities.nodeType === 'unknown') return [];
    return SOURCE_CHOICES.filter(([, source]) =>
        SOURCE_CAPABILITY_ALIASES[source].some(alias => capabilities.sources.has(alias) && !capabilities.unavailable.has(alias))
    ).map(([name, value]) => ({ name, value }));
}

function addSourceOption(builder, name, description, includeAuto = false) {
    const choices = getSupportedSourceChoices();
    if (includeAuto) choices.unshift({ name: 'Automatic fallback order', value: 'auto' });
    if (!choices.length) return builder;
    return builder.addStringOption(option => option.setName(name).setDescription(description).addChoices(...choices));
}

function autocompleteTrackChoices(tracks, userId) {
    return tracks.slice(0, 25).map(track => ({
        name: `${track.author || 'Unknown'} - ${track.title}`.slice(0, 100),
        value: createSelection(userId, { track })
    }));
}

function autocompleteGlobalChoices(tracks, userId) {
    return tracks.slice(0, 25).map(track => ({
        name: `★ ${track.author ? `${track.author} - ` : ''}${track.title} (${track.count} plays)`.slice(0, 100),
        value: createSelection(userId, { query: track.uri || `${track.author || ''} ${track.title}`.trim() })
    }));
}

function createDefinitions() {
    return [
    ['play', 'Play a song or playlist', b => b
        .addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true).setAutocomplete(true)),
        b => addSourceOption(b, 'source', 'Search source')],
    ['source', 'View or set this server’s default search source', b => addSourceOption(b, 'platform', 'Use auto to reset', true)],
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
    ].map(([name, description, ...addOptions]) => {
        let builder = new SlashCommandBuilder().setName(name).setDescription(description);
        for (const addOptionsFn of addOptions) builder = addOptionsFn(builder) || builder;
        return builder.toJSON();
    });
}
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
    const definitions = createDefinitions();
    await rest.put(route, { body: definitions });
    console.log(`[commands] registered ${definitions.length} slash commands`);
}

function registerInteractionCreate() {
    client.on(Events.InteractionCreate, async interaction => {
        if (interaction.isAutocomplete()) {
            if (interaction.commandName !== 'play') return interaction.respond([]);
            const query = interaction.options.getFocused().trim();
            if (!query) return interaction.respond(autocompleteGlobalChoices(getGlobalTopTracks(25), interaction.user.id));
            if (query.length < 2 || /^https?:\/\//i.test(query)) return interaction.respond([]);
            try {
                const explicitSource = interaction.options.getString('source');
                const defaultSource = getUsableDefaultSearchSource(interaction.guildId);
                const selectedSource = explicitSource || defaultSource || 'soundcloud';
                const source = resolveSourceName(selectedSource);
                const cached = getCachedSuggestions(source, query);
                if (cached) return interaction.respond(autocompleteTrackChoices(cached, interaction.user.id));
                if (!canSearchAutocomplete(interaction.user.id)) return interaction.respond([]);
                const search = searchWithRetry(null, query.slice(0, 100), interaction.user, source)
                    .then(result => (result.tracks || []).slice(0, 25));
                const suggestions = await Promise.race([
                    search,
                    new Promise(resolve => setTimeout(() => resolve({ tracks: [] }), 2300))
                ]);
                if (Array.isArray(suggestions)) {
                    cacheSuggestions(source, query, suggestions);
                    return interaction.respond(autocompleteTrackChoices(suggestions, interaction.user.id));
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
            const selected = consumeSelection(interaction.options.getString('query'), interaction.user.id);
            const message = toMessage(interaction);
            if (selected?.track) message.autocompleteTrack = selected.track;
            if (selected?.query) message.autocompleteQuery = selected.query;
            args.push(selected?.query || selected?.track?.title || interaction.options.getString('query'));
            const source = interaction.options.getString('source');
            const sourceFlags = { youtube: '--yt', youtubemusic: '--ytm', soundcloud: '--sc', spotify: '--sp', deezer: '--dz', applemusic: '--am', tidal: '--td' };
            if (sourceFlags[source]) args.push(sourceFlags[source]);
            return executeInteractionCommand(interaction, handler, args, message);
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
        return executeInteractionCommand(interaction, handler, args, toMessage(interaction));
    });
}

async function executeInteractionCommand(interaction, handler, args, message) {
    try {
            const rateLimitCommand = interaction.commandName === 'play' ? 'play'
                : interaction.commandName === 'skip' ? 'skip'
                    : interaction.commandName === 'seek' ? 'seek'
                        : ['nightcore', 'vaporwave', 'tremolo', 'vibrato', 'rotation', 'lowpass', 'echo', 'karaoke'].includes(interaction.commandName) ? 'filter' : null;
            const retryAfter = checkRateLimit(message, rateLimitCommand);
            if (retryAfter) {
                return interaction.reply({ content: `Please wait ${Math.ceil(retryAfter / 1000)}s before using this command again.`, ephemeral: true });
            }
            await handler.execute(message, args);
        } catch (error) {
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Command failed.', ephemeral: true });
            handleError(message, error);
        }
}
//
module.exports = { registerInteractionCreate, registerSlashCommands };
// contributors: @relentiousdragon
