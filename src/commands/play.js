const { EmbedBuilder } = require('discord.js');
const manager = require('../manager');
const client = require('../client');
const { playerStates, selectionCollectors, colorCache } = require('../state');
const { createEmbed } = require('../utils/embeds');
const { getFormattedDuration, getTrackUrl, getRequesterId } = require('../utils/format');
const logger = require('../utils/logger');
const { getDominantColor, getPlatformColor } = require('../utils/color');
const { getPlatformEmoji } = require('../utils/metadata');
const { searchWithRetry } = require('../utils/search');
const { resolveSourceName } = require('../utils/capabilities');
const { getEmoji } = require('../utils/emojis');
const { getBotFooter } = require('../utils/branding');
const { getUsableDefaultSearchSource } = require('../utils/guildSettings');
//
async function execute(message, args) {
    try {
        const guild = message.guild;
        const channel = message.channel;

        if (!message.member.voice.channel) {
            return message.channel.send({
                embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Voice Channel Required`, 'You must be in a voice channel to play music!', '#FFA500')]
            });
        }

        const flags = args.filter(arg => arg.startsWith('--')).map(arg => arg.toLowerCase());
        const showResults = flags.includes('--sr') || flags.includes('--show-results');
        const useYoutube = flags.includes('--yt') || flags.includes('--youtube');
        const useYoutubeMusic = flags.includes('--ytm') || flags.includes('--youtube-music') || flags.includes('--youtubemusic');
        const useSpotify = flags.includes('--sp') || flags.includes('--spotify');
        const useSoundcloud = flags.includes('--sc') || flags.includes('--soundcloud');
        const useDeezer = flags.includes('--dz') || flags.includes('--deezer');
        const useAppleMusic = flags.includes('--am') || flags.includes('--apple');
        const useTidal = flags.includes('--td') || flags.includes('--tidal');

        const query = args.filter(arg => !arg.startsWith('--')).join(' ');
        if (!query) {
            return message.channel.send({
                embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Missing Query`, 'Please provide a song name or URL!', '#FFA500')]
            });
        }

        let player = manager.players.get(message.guild.id);

        if (player && player.voiceChannelId !== message.member.voice.channel.id) {
            return message.channel.send({
                embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Channel Mismatch`, 'You must be in the same voice channel as the bot!', '#FFA500')]
            });
        }

        const loadingMsg = await message.channel.send({
            content: `${getEmoji('loading', guild, channel)} Searching...`
        });

        try {
            if (!player) {
                if (manager.nodes.nodes.size === 0) {
                    throw new Error('No nodes configured. Please wait a moment or check configuration.');
                }

                player = manager.players.create({
                    guildId: message.guild.id,
                    voiceChannelId: message.member.voice.channel.id,
                    textChannelId: message.channel.id,
                    volume: 100,
                    autoPlay: false
                });
                await player.connect({ selfDeaf: true });
            } else {
                player.textChannelId = message.channel.id;
            }

            let source = null;
            if (!/^https?:\/\//i.test(query)) {
                if (useYoutube) source = resolveSourceName('youtube');
                else if (useYoutubeMusic) source = resolveSourceName('youtubemusic');
                else if (useSpotify) source = resolveSourceName('spotify');
                else if (useSoundcloud) source = resolveSourceName('soundcloud');
                else if (useDeezer) source = resolveSourceName('deezer');
                else if (useAppleMusic) source = resolveSourceName('applemusic');
                else if (useTidal) source = resolveSourceName('tidal');
                else {
                    const defaultSource = getUsableDefaultSearchSource(guild.id);
                    if (defaultSource) source = resolveSourceName(defaultSource);
                }
            }

            const result = await searchWithRetry(player, query, message.author, source);

            if (result.loadType === 'empty' || result.loadType === 'error' || !result.tracks?.length) {
                const reason = result.error?.message || result.error;
                const youtubeRequested = ['youtube', 'ytsearch', 'youtubemusic', 'ytmsearch'].includes(source);
                const description = youtubeRequested
                    ? 'YouTube search failed on the connected Lavalink node. Enable a working YouTube source/plugin on that node, then try again.\n\n' + (reason || 'The node returned no tracks.')
                    : reason || 'No tracks found for your query.';
                await loadingMsg.edit({
                    content: '',
                    embeds: [createEmbed(`${getEmoji(youtubeRequested ? 'warning' : 'xmark', guild, channel)} ${youtubeRequested ? 'YouTube Node Health Warning' : 'Search Unavailable'}`, description, '#FF0000')]
                });
                return;
            }

            let tracksToPlay = [];

            if (showResults && result.loadType === 'search' && result.tracks.length > 1) {
                const top5 = result.tracks.slice(0, 5);
                const selectEmbed = new EmbedBuilder()
                    .setTitle(`${getEmoji('headphones', guild, channel)} Select a Track`)
                    .setDescription(top5.map((t, i) => `**${i + 1}.** ${t.author || 'Unknown'} - [${t.title}](${getTrackUrl(t)}) \`(${getFormattedDuration(t)})\``).join('\n'))
                    .setColor('#6A5ACD')
                    .setFooter({ text: 'Selection expires in 60s | Type 1-5 to select' });

                await loadingMsg.edit({ content: '', embeds: [selectEmbed], components: [] });

                if (selectionCollectors.has(message.author.id)) {
                    selectionCollectors.get(message.author.id).stop('new_selection');
                }

                const collector = message.channel.createMessageCollector({
                    filter: m => m.author.id === message.author.id && ['1', '2', '3', '4', '5'].includes(m.content) && parseInt(m.content) <= top5.length,
                    time: 60000,
                    max: 1
                });

                selectionCollectors.set(message.author.id, collector);

                const selected = await new Promise(resolve => {
                    collector.on('collect', m => {
                        const index = parseInt(m.content) - 1;
                        try { m.delete().catch(() => { }); } catch (e) { }
                        resolve(top5[index]);
                    });
                    collector.on('end', (collected, reason) => {
                        selectionCollectors.delete(message.author.id);
                        if (reason !== 'limit') resolve(null);
                    });
                });

                if (!selected) {
                    try { await loadingMsg.delete().catch(() => { }); } catch (e) { }
                    return;
                }

                tracksToPlay = [selected];
            } else {
                tracksToPlay = result.loadType === 'playlist' ? result.tracks : [result.tracks[0]];
            }

            const wasEmpty = !player.current && player.queue.tracks.length === 0;

            if (result.loadType === 'playlist') {
                result.tracks.forEach(t => {
                    if (!t.userData) t.userData = {};
                    t.userData.requester = message.author;
                });
                player.queue.add(result.tracks);
                await loadingMsg.delete().catch(() => { });

                if (!wasEmpty) {
                    const embed = new EmbedBuilder()
                        .setTitle(`${getEmoji('checkmark', guild, channel)} Added Playlist to Queue`)
                        .setDescription(`Added **${result.tracks.length}** tracks from **${result.playlistInfo?.name || 'Playlist'}**`)
                        .setColor('#00FF00')
                        .setFooter(getBotFooter())
                        .setTimestamp();
                    message.channel.send({ embeds: [embed] });
                }
            } else {
                const track = tracksToPlay[0];
                if (!track.userData) track.userData = {};
                track.userData.requester = message.author;
                player.queue.add(track);

                try { await loadingMsg.delete(); } catch { }

                if (!wasEmpty) {
                    const platformEmoji = getPlatformEmoji(track, guild, channel);
                    const art = track.artworkUrl;

                    const sendAddedEmbed = async () => {
                        let embedColor = '#00FF00';
                        if (art) {
                            if (colorCache.has(art)) {
                                embedColor = colorCache.get(art);
                            } else {
                                try {
                                    const domColor = await getDominantColor(art);
                                    if (domColor) {
                                        embedColor = domColor;
                                        colorCache.set(art, domColor);
                                    }
                                } catch (e) { }
                            }
                        }

                        const embed = new EmbedBuilder()
                            .setTitle(`${getEmoji('checkmark', guild, channel)} Added to Queue`)
                            .setDescription(`${platformEmoji} [${track.title}](${getTrackUrl(track)})`)
                            .setColor(embedColor)
                            .addFields(
                                { name: 'Duration', value: `\`${getFormattedDuration(track)}\``, inline: true },
                                { name: 'Requested By', value: `<@${message.author.id}>`, inline: true }
                            )
                            .setFooter(getBotFooter())
                            .setTimestamp();

                        if (art) embed.setThumbnail(art);
                        message.channel.send({ embeds: [embed] });
                    };

                    sendAddedEmbed();
                }
            }

            if (!player.playing && !player.paused) {
                try {
                    await player.play();
                } catch (e) {
                    console.log(`[play] playback start failed: ${e.message}`);
                    message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Playback Error`, `Could not start playback: ${e.message}`, '#FF0000')] });
                }
            }

            logger.info('player_state', {
                guild: message.guild.id,
                state: player.playing ? 'playing' : player.paused ? 'paused' : 'idle',
                source: source || 'fallback-order',
                track: player.current?.title
            });

        } catch (error) {
            console.log(`[play] error: ${error.message}`);
            try {
                if (loadingMsg) {
                    await loadingMsg.edit({
                        content: '',
                        embeds: [createEmbed(
                            `${getEmoji('xmark', guild, channel)} Playback Failed`,
                            error.message.includes('No result returned')
                                ? 'The track could not be played (no result returned)'
                                : `${error.message}`,
                            '#FF0000'
                        )]
                    });
                }
            } catch (editErr) {
                message.channel.send({
                    embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Playback Failed`, `${error.message}`, '#FF0000')]
                });
            }
        }
    } catch (error) {
        const { handleError } = require('../utils/embeds');
        handleError(message, error, 'Failed to process command');
    }
}
//
module.exports = { execute, aliases: ['p'] };
// contributors: @relentiousdragons
