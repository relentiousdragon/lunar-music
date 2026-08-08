const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { WebSocketServer } = require('ws');
const client = require('../client');
const manager = require('../manager');
const { searchWithRetry } = require('../utils/search');
const { getUsableDefaultSearchSource, VALID_SOURCES } = require('../utils/guildSettings');
const { resolveSourceName, supports } = require('../utils/capabilities');
const { getMoonlinkPlaybackPosition, getDirectNodePlaybackPosition } = require('../utils/playbackPosition');
const { playerStates } = require('../state');
const { getArtworkPalette, getPlatformPalette } = require('../utils/color');
const { getBotName } = require('../utils/branding');
const { cacheArtwork, getCacheUrl } = require('../utils/artworkCache');
const { fetchTrackMetadata } = require('../utils/metadata');
const logger = require('../utils/logger');

const ACTIVITY_ROOT = path.join(process.cwd(), 'activity');
const ASSETS_ROOT = path.join(process.cwd(), 'assets');
const SDK_ROOT = path.join(process.cwd(), 'node_modules', '@discord', 'embedded-app-sdk', 'output');
const MAX_MESSAGE_BYTES = 8192;
const ALLOWED_ART_HOSTS = new Set([
    'i.scdn.co', 'mosaic.scdn.co', 'image-cdn-az.spotify.com',
    'i.ytimg.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com',
    'resources.tidal.com',
    'e-cdns-images.dzcdn.net', 'cdn-images.dzcdn.net',
    'is1-ssl.mzstatic.com', 'is2-ssl.mzstatic.com', 'is3-ssl.mzstatic.com', 'is4-ssl.mzstatic.com', 'is5-ssl.mzstatic.com',
    'media.discordapp.net', 'cdn.discordapp.com',
    'i1.sndcdn.com', 'i2.sndcdn.com', 'i3.sndcdn.com',
    't2.genius.com', 'images.genius.com',
    'lh3.googleusercontent.com',
    'pbs.twimg.com',
    'www.deezer.com',
    'i.fi.sls.co', 'i.ytimg.co'
]);
const artworkPalettes = new Map();
const activityBpmCache = new Map();
const activityBpmPending = new Set();
const ACTIVITY_BPM_TTL = 24 * 60 * 60 * 1000;
const ACTIVITY_SOURCES = ['youtube', 'youtubemusic', 'soundcloud', 'spotify', 'deezer', 'applemusic', 'tidal', 'monochrome'];
//
const relatedTracksCache = new Map(); // guildId { trackKey: string, tracks: [], expiresAt: number }ss
const RELATED_TRACKS_TTL = 300_000;
//
async function refreshRelatedTracks(guildId, currentTrack, searchSources) {
    if (!currentTrack || !currentTrack.title) return;
    const trackKey = `${currentTrack.title}:${currentTrack.author}`;
    const cached = relatedTracksCache.get(guildId);
    if (cached && cached.trackKey === trackKey && Date.now() < cached.expiresAt) return;
    try {
        const query = currentTrack.author || currentTrack.title;
        const requester = { id: 'activity' };
        const source = searchSources?.defaultSource ? resolveSourceName(searchSources.defaultSource) : null;
        const result = await searchWithRetry(null, query, requester, source);
        const normTitle = currentTrack.title.toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
        const tracks = (result?.tracks || [])
            .filter(t => {
                const tNorm = (t.title || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                return tNorm !== normTitle && !tNorm.includes(normTitle) && !normTitle.includes(tNorm);
            })
            .slice(0, 6)
            .map(t => safeTrack(t));
        tracks.forEach(t => precacheArtwork(t));
        relatedTracksCache.set(guildId, { trackKey, tracks, expiresAt: Date.now() + RELATED_TRACKS_TTL });
    } catch (err) {
        logger.warn('activity_related_tracks_fetch_failed', { error: err.message, guildId });
    }
}

function getRelatedTracks(guildId, currentTrack) {
    if (!currentTrack || !currentTrack.title) return [];
    const trackKey = `${currentTrack.title}:${currentTrack.author}`;
    const cached = relatedTracksCache.get(guildId);
    if (cached && cached.trackKey === trackKey && Date.now() < cached.expiresAt) return cached.tracks;
    return [];
}

const STATS_DIR = path.join(process.cwd(), 'stats');
const topTracksCache = new Map();
const TOP_TRACKS_CACHE_TTL = 600_000;

function getTopTracksFromStats(guildId) {
    try {
        if (!fs.existsSync(STATS_DIR)) return [];
        const aggregate = {};
        const files = fs.readdirSync(STATS_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(STATS_DIR, file), 'utf8'));
                if (!data.totalPlays) continue;
                const isGuildFile = file === `${guildId}.json`;
                for (const [id, song] of Object.entries(data.totalPlays)) {
                    if (!song?.title) continue;
                    if (!aggregate[id]) {
                        aggregate[id] = { count: 0, title: song.title, author: song.author || '', uri: song.uri || null, guildOnly: 0 };
                    }
                    aggregate[id].count += song.count || 0;
                    if (isGuildFile) aggregate[id].guildOnly += song.count || 0;
                }
            } catch { continue; }
        }
        return Object.values(aggregate)
            .sort((a, b) => (b.guildOnly * 10 + b.count) - (a.guildOnly * 10 + a.count))
            .slice(0, 10);
    } catch { return []; }
}

function getActivitySources(guildId) {
    const defaultSource = getUsableDefaultSearchSource(guildId) || 'soundcloud';
    const sources = ACTIVITY_SOURCES.filter(source => VALID_SOURCES.has(source) && supports(source));
    return { defaultSource, sources: sources.includes(defaultSource) ? sources : [defaultSource, ...sources] };
}

function hidesLyrics(track) {
    const source = String(track?.sourceName || '').toLowerCase();
    return (source.includes('youtube') || source.includes('ytsearch')) && !source.includes('music') && !source.includes('ytm');
}

function getArtworkPaletteCached(track) {
    const artwork = track?.artworkUrl;
    if (!artwork) return getPlatformPalette(track);
    const cached = artworkPalettes.get(artwork);
    if (cached) return cached;
    const fallback = getPlatformPalette(track);
    artworkPalettes.set(artwork, fallback);
    getArtworkPalette(artwork)
        .then(palette => artworkPalettes.set(artwork, palette))
        .catch(() => { });
    return fallback;
}

function requireConfig() {
    const clientId = process.env.ACTIVITY_DISCORD_CLIENT_ID || client.user?.id;
    const clientSecret = process.env.ACTIVITY_DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.ACTIVITY_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) return null;
    return { clientId, clientSecret, redirectUri };
}

function safeFile(root, requestedPath) {
    const file = path.resolve(root, requestedPath.replace(/^\/+/, ''));
    return file.startsWith(`${root}${path.sep}`) || file === root ? file : null;
}

function contentType(file) {
    if (file.endsWith('.html')) return 'text/html; charset=utf-8';
    if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
    if (file.endsWith('.css')) return 'text/css; charset=utf-8';
    if (file.endsWith('.svg')) return 'image/svg+xml';
    if (file.endsWith('.webp')) return 'image/webp';
    if (file.endsWith('.png')) return 'image/png';
    if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
}

function sendJson(ws, payload) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function getActivityBpm(track) {
    const nativeBpm = Number(track?.pluginInfo?.bpm) || Number(track?.info?.bpm) || Number(track?.bpm) || null;
    if (nativeBpm >= 40 && nativeBpm <= 300) return nativeBpm;
    const title = String(track?.title || '').trim();
    const author = String(track?.author || '').trim();
    const duration = Number(track?.duration) || 0;
    if (!title || !author || !duration) return null;
    const key = `${title.toLowerCase()}\u0000${author.toLowerCase()}\u0000${Math.round(duration / 1000)}`;
    const cached = activityBpmCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.bpm;
    if (!activityBpmPending.has(key)) {
        activityBpmPending.add(key);
        fetchTrackMetadata(title, author, duration).then(metadata => {
            activityBpmCache.set(key, { bpm: metadata?.bpm || null, expiresAt: Date.now() + ACTIVITY_BPM_TTL });
        }).catch(() => {
            activityBpmCache.set(key, { bpm: null, expiresAt: Date.now() + ACTIVITY_BPM_TTL });
        }).finally(() => activityBpmPending.delete(key));
    }
    return null;
}

function safeTrack(track, index = null, enrichBpm = false) {
    const requester = track?.userData?.requester || track?.requester;
    const rawArt = track?.artworkUrl || null;
    const artworkUrl = rawArt ? (getCacheUrl(rawArt) || rawArt) : null;
    const bpm = enrichBpm ? getActivityBpm(track) : (Number(track?.pluginInfo?.bpm) || null);
    return {
        index,
        title: String(track?.title || 'Unknown Track').slice(0, 180),
        author: String(track?.author || 'Unknown Artist').slice(0, 120),
        duration: Number(track?.duration) || 0,
        artworkUrl,
        uri: track?.uri || track?.url || null,
        requester: requester?.id ? { id: requester.id, username: requester.username || requester.globalName || 'User', avatar: requester.displayAvatarURL?.() || null } : null,
        sourceName: track?.sourceName || null,
        bpm
    };
}

function precacheArtwork(track) {
    const url = track?.artworkUrl;
    if (url) cacheArtwork(url).catch(() => { });
}

const FILTER_DEFS = {
    nightcore: { apply: p => p.filters.setTimescale({ speed: 1.15, pitch: 1.15, rate: 1.0 }), clear: p => p.filters.setTimescale(null) },
    vaporwave: { apply: p => p.filters.setTimescale({ speed: 0.85, pitch: 0.85, rate: 1.0 }), clear: p => p.filters.setTimescale(null) },
    tremolo: { apply: p => p.filters.setTremolo({ frequency: 4.0, depth: 0.75 }), clear: p => p.filters.setTremolo(null) },
    vibrato: { apply: p => p.filters.setVibrato({ frequency: 4.0, depth: 0.75 }), clear: p => p.filters.setVibrato(null) },
    rotation: { apply: p => p.filters.setRotation({ rotationHz: 0.2 }), clear: p => p.filters.setRotation(null) },
    lowpass: { apply: p => p.filters.setLowPass({ smoothing: 20.0 }), clear: p => p.filters.setLowPass(null) },
    echo: { apply: p => p.filters.setEcho({ echoLength: 0.5, decay: 0.5 }), clear: p => p.filters.setEcho(null) },
    karaoke: { apply: p => p.filters.setKaraoke({ level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 }), clear: p => p.filters.setKaraoke(null) }
};

function getSnapshot(guildId) {
    const player = manager.players.get(guildId);
    if (!player) {
        const state = playerStates.get(guildId) || {};
        if (state.isBreaking) {
            return {
                type: 'state',
                guildId,
                player: {
                    playing: false, paused: false, volume: 100,
                    position: 0, updatedAt: Date.now(),
                    current: null,
                    palette: null,
                    filters: {},
                    hasPrevious: false, queueLength: 0,
                    onBreak: true,
                    breakUntil: state.breakUntil || 0
                },
                queue: [],
                lyrics: []
            };
        }
        return { type: 'state', guildId, player: null, queue: [], lyrics: [] };
    }
    const state = playerStates.get(guildId) || {};
    const now = Date.now();
    const position = getMoonlinkPlaybackPosition(player, now) ?? getDirectNodePlaybackPosition(player, state, now) ?? state.manualPos ?? 0;
    return {
        type: 'state',
        guildId,
        player: {
            playing: Boolean(player.playing), paused: Boolean(player.paused), volume: player.volume,
            position: Math.max(0, Math.floor(position)), updatedAt: now,
            current: player.current ? safeTrack(player.current, null, true) : null,
            palette: getArtworkPaletteCached(player.current),
            filters: Object.fromEntries(['nightcore', 'vaporwave', 'tremolo', 'vibrato', 'rotation', 'lowpass', 'echo', 'karaoke'].map(name => [name, Boolean(state[name])])),
            filterCooldown: state._filterCooldownUntil > Date.now() ? state._filterCooldownUntil : 0,
            hasPrevious: Boolean(player.previous && player.previous.length > 0),
            queueLength: player.queue.tracks.length
        },
        queue: player.queue.tracks.slice(0, 100).map((track, index) => safeTrack(track, index)),
        lyrics: Array.isArray(state.lyrics) ? state.lyrics.slice(0, 600).map(line => ({ time: line.time, text: String(line.text).slice(0, 240) })) : [],
        relatedTracks: getRelatedTracks(guildId, player.current)
    };
}

async function exchangeCode(code, config) {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code, redirect_uri: config.redirectUri })
    });
    if (!tokenResponse.ok) throw new Error('Discord authorization exchange failed');
    const token = await tokenResponse.json();
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [userResponse, guildResponse] = await Promise.all([
        fetch('https://discord.com/api/users/@me', { headers }),
        fetch('https://discord.com/api/users/@me/guilds', { headers })
    ]);
    if (!userResponse.ok || !guildResponse.ok) throw new Error('Discord identity verification failed');
    const scopes = String(token.scope || '').split(/\s+/).filter(Boolean);
    return { user: await userResponse.json(), guilds: await guildResponse.json(), scopes, accessToken: token.access_token };
}

async function requireVoiceAccess(session) {
    const player = manager.players.get(session.guildId);
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) throw new Error('Guild is unavailable');
    const member = await guild.members.fetch(session.user.id);
    if (!member.voice?.channelId) throw new Error('Join a voice channel before changing the queue');
    if (member.voice.channelId !== session.channelId) throw new Error('Reopen the Activity from the voice channel you are currently in');
    if (player && member.voice.channelId !== player.voiceChannelId) throw new Error('Join the bot’s voice channel to change its queue');
    return { player, member, guild };
}

async function ensurePlayer(session, member, guild) {
    let player = manager.players.get(session.guildId);
    if (player) return player;
    const textChannelId = member.voice.channelId;
    player = manager.players.create({ guildId: session.guildId, voiceChannelId: member.voice.channelId, textChannelId, volume: 100, autoPlay: false });
    await player.connect({ selfDeaf: true });
    return player;
}

function isAllowedArtwork(url) {
    try { return new URL(url).protocol === 'https:' && ALLOWED_ART_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

function createActivityServer() {
    const config = requireConfig();
    if (!config || process.env.ACTIVITY_ENABLED !== 'true') return null;
    const allowInsecure = process.env.ACTIVITY_ALLOW_INSECURE_LOCAL === 'true';
    const keyPath = process.env.ACTIVITY_TLS_KEY_PATH;
    const certPath = process.env.ACTIVITY_TLS_CERT_PATH;
    if (!allowInsecure && (!keyPath || !certPath)) throw new Error('Activity requires ACTIVITY_TLS_KEY_PATH and ACTIVITY_TLS_CERT_PATH (or ACTIVITY_ALLOW_INSECURE_LOCAL=true for localhost development).');

    const requestHandler = async (req, res) => {
        const requestUrl = new URL(req.url, 'http://localhost');
        try {
            if (requestUrl.pathname === '/config') {
                return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify({ clientId: config.clientId, botAvatar: client.user?.displayAvatarURL({ extension: 'png', size: 128 }) || null, botName: getBotName() }));
            }
            if (requestUrl.pathname === '/artwork') {
                const artwork = requestUrl.searchParams.get('url');
                if (!artwork) return res.writeHead(400).end('Missing artwork URL');
                const cached = getCacheUrl(artwork);
                if (cached) return res.writeHead(302, { 'Location': cached }).end();
                if (!isAllowedArtwork(artwork)) return res.writeHead(400).end('Unsupported artwork host');
                const upstream = await fetch(artwork, { signal: AbortSignal.timeout(8000) });
                const type = upstream.headers.get('content-type') || '';
                if (!upstream.ok || !type.startsWith('image/')) return res.writeHead(404).end();
                const bytes = Buffer.from(await upstream.arrayBuffer());
                if (bytes.length > 5 * 1024 * 1024) return res.writeHead(413).end();
                return res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).end(bytes);
            }
            if (requestUrl.pathname.startsWith('/artwork/cache/')) {
                const filename = requestUrl.pathname.slice('/artwork/cache/'.length);
                if (filename.includes('..') || filename.includes('/')) return res.writeHead(400).end();
                const cacheDir = path.join(process.cwd(), '.moonlink', 'artwork-cache');
                const filePath = path.join(cacheDir, filename);
                if (!fs.existsSync(filePath)) return res.writeHead(404).end();
                const ext = path.extname(filePath).toLowerCase();
                const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
                return res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' }).end(fs.readFileSync(filePath));
            }
            const root = requestUrl.pathname.startsWith('/activity/sdk/') ? SDK_ROOT : requestUrl.pathname.startsWith('/assets/') ? ASSETS_ROOT : ACTIVITY_ROOT;
            const relative = requestUrl.pathname.startsWith('/activity/sdk/') ? requestUrl.pathname.slice('/activity/sdk/'.length) : requestUrl.pathname.startsWith('/assets/') ? requestUrl.pathname.slice('/assets/'.length) : (requestUrl.pathname === '/' || requestUrl.pathname === '/activity' ? 'index.html' : requestUrl.pathname.replace(/^\/activity\/?/, ''));
            const file = safeFile(root, relative || 'index.html');
            if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('Not found');
            return res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }).end(fs.readFileSync(file));
        } catch (error) {
            logger.warn('activity_http_error', { error: error.message });
            return res.writeHead(500).end('Server error');
        }
    };

    const server = allowInsecure
        ? http.createServer(requestHandler)
        : https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), minVersion: 'TLSv1.2' }, requestHandler);
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    const sessions = new Set();

    server.on('upgrade', (req, socket, head) => {
        if (new URL(req.url, 'http://localhost').pathname !== '/ws') return socket.destroy();
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
    });

    const broadcastGuild = guildId => {
        const snapshot = getSnapshot(guildId);
        const voiceChannelId = manager.players.get(guildId)?.voiceChannelId;
        for (const session of sessions) {
            if (session.guildId === guildId && (!voiceChannelId || session.channelId === voiceChannelId)) sendJson(session.ws, snapshot);
        }
    };

    wss.on('connection', ws => {
        const session = { ws, user: null, guildId: null, channelId: null, searchResults: [] };
        sessions.add(session);
        ws.on('close', () => sessions.delete(session));
        ws.on('message', async data => {
            try {
                const message = JSON.parse(String(data));
                if (message.type === 'auth') {
                    if (session.user) throw new Error('Already authenticated');
                    if (!message.code || !message.guildId || !message.channelId) throw new Error('Incomplete Activity authorization');
                    const identity = await exchangeCode(message.code, config);
                    if (!identity.guilds.some(guild => guild.id === message.guildId)) throw new Error('User is not a member of this guild');
                    const guild = client.guilds.cache.get(message.guildId);
                    if (!guild) throw new Error('Guild is unavailable');
                    const member = await guild.members.fetch(identity.user.id);
                    const getBotName = () => process.env.BOT_NAME || 'Lunar';
                    if (!member.voice?.channelId || member.voice.channelId !== message.channelId) throw new Error(`Launch ${getBotName()} from the voice channel you are currently in`);
                    const player = manager.players.get(message.guildId);
                    if (player && player.voiceChannelId !== member.voice.channelId) throw new Error('Join the bot’s voice channel before opening this Activity');
                    session.user = identity.user;
                    session.guildId = message.guildId;
                    session.channelId = message.channelId;
                    session.scopes = identity.scopes || [];
                    session.accessToken = identity.accessToken;
                    sendJson(ws, { type: 'ready', user: { id: identity.user.id, username: identity.user.global_name || identity.user.username }, scopes: session.scopes, accessToken: session.accessToken, search: getActivitySources(session.guildId), state: getSnapshot(session.guildId), rateAggro: process.env.RATE_RESPECT_AGGRO === 'true' });
                    return;
                } else if (message.type === 'reauth') {
                    if (!message.code) throw new Error('Incomplete reauthorization request');
                    const identity = await exchangeCode(message.code, config);
                    session.user = identity.user;
                    session.scopes = identity.scopes || [];
                    session.accessToken = identity.accessToken;
                    sendJson(ws, { type: 'reauth-ok', scopes: session.scopes, accessToken: session.accessToken });
                    return;
                }
                if (!session.user) throw new Error('Authenticate before using the Activity');
                if (message.type === 'search') {
                    await requireVoiceAccess(session);
                    const query = String(message.query || '').trim().slice(0, 120);
                    if (!query) return sendJson(ws, { type: 'search-results', results: [] });
                    const available = getActivitySources(session.guildId);
                    const requested = String(message.source || available.defaultSource).toLowerCase();
                    const isUrl = /^https?:\/\//i.test(query);
                    const source = isUrl
                        ? null
                        : resolveSourceName(requested);
                    const result = await searchWithRetry(null, query, session.user, source);
                    if (isUrl && result?.tracks?.length > 1) {
                        const { player: plPlayer, member: plMember, guild: plGuild } = await requireVoiceAccess(session);
                        const activePlayer = await ensurePlayer(session, plMember, plGuild);
                        result.tracks.forEach(t => {
                            if (!t.userData) t.userData = {};
                            t.userData.requester = session.user;
                            activePlayer.queue.add(t);
                        });
                        if (!activePlayer.playing && !activePlayer.paused) await activePlayer.play();
                        broadcastGuild(session.guildId);
                        return sendJson(ws, { type: 'playlist-added', count: result.tracks.length });
                    }
                    if (isUrl && result?.tracks?.length === 1) {
                        const { member: trackMember, guild: trackGuild } = await requireVoiceAccess(session);
                        const activePlayer = await ensurePlayer(session, trackMember, trackGuild);
                        const track = result.tracks[0];
                        track.userData = { ...(track.userData || {}), requester: session.user };
                        activePlayer.queue.add(track);
                        if (!activePlayer.playing && !activePlayer.paused) await activePlayer.play();
                        broadcastGuild(session.guildId);
                        return sendJson(ws, { type: 'track-added', track: safeTrack(track) });
                    }
                    session.searchResults = (result.tracks || []).slice(0, 10);
                    return sendJson(ws, { type: 'search-results', results: session.searchResults.map((track, index) => safeTrack(track, index)) });
                }
                if (message.type === 'top-tracks') {
                    await requireVoiceAccess(session);
                    const guildId = session.guildId;
                    const cached = topTracksCache.get(guildId);
                    if (cached && Date.now() < cached.expiresAt) {
                        session.searchResults = cached.data;
                    } else {
                        const topTracks = getTopTracksFromStats(guildId);
                        const mapped = topTracks.map(t => ({ title: t.title, author: t.author, uri: t.uri, duration: 0, artworkUrl: null, requester: null, sourceName: null }));
                        topTracksCache.set(guildId, { data: mapped, expiresAt: Date.now() + TOP_TRACKS_CACHE_TTL });
                        session.searchResults = mapped;
                    }
                    return sendJson(ws, { type: 'top-results', results: session.searchResults });
                }
                const { player, member, guild } = await requireVoiceAccess(session);
                if (message.type === 'enqueue') {
                    let track = session.searchResults[Number(message.index)];
                    if (!track) throw new Error('Search result expired; search again');
                    const activePlayer = await ensurePlayer(session, member, guild);
                    if (!track.encoded && track.uri) {
                        const result = await searchWithRetry(null, track.uri, session.user, null).catch(() => null);
                        if (result?.tracks?.length) {
                            const normT = (track.title || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                            const normA = (track.author || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                            const match = result.tracks.find(t => {
                                const tN = (t.title || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                                const aN = (t.author || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                                return tN === normT && aN === normA;
                            });
                            track = match || result.tracks[0];
                        } else {
                            track = { encoded: null, info: { title: track.title, author: track.author || 'Unknown', identifier: track.title, uri: track.uri, isSeekable: true, isStream: false, length: 0, sourceName: null }, pluginInfo: {}, userData: {} };
                        }
                    }
                    track.userData = { ...(track.userData || {}), requester: session.user };
                    activePlayer.queue.add(track);
                    if (!activePlayer.playing && !activePlayer.paused) await activePlayer.play();
                    broadcastGuild(session.guildId);
                    return;
                }
                if (!player) throw new Error('Nothing is currently playing');
                if (message.type === 'queue-remove') {
                    if (!player.queue.remove(Number(message.index))) throw new Error('Queue item no longer exists');
                } else if (message.type === 'queue-move') {
                    if (!player.queue.move(Number(message.from), Number(message.to))) throw new Error('Invalid queue position');
                } else if (message.type === 'pause') {
                    if (player.paused) throw new Error('Already paused');
                    player.pause();
                } else if (message.type === 'resume') {
                    if (!player.paused) throw new Error('Not paused');
                    player.resume();
                } else if (message.type === 'skip') {
                    if (player._isNavigating) return;
                    player._isNavigating = true;
                    try {
                        if (player.queue.tracks.length === 0) { player.queue.clear(); player.stop(); }
                        else await player.skip();
                    } finally {
                        player._isNavigating = false;
                    }
                } else if (message.type === 'back') {
                    if (player._isNavigating) return;
                    player._isNavigating = true;
                    try {
                        const state = playerStates.get(session.guildId) || {};
                        const now = Date.now();
                        const pos = getMoonlinkPlaybackPosition(player, now) ?? getDirectNodePlaybackPosition(player, state, now) ?? state.manualPos ?? player.position ?? 0;
                        if (pos > 10000 || !player.previous || player.previous.length === 0) {
                            await player.seek(0);
                        } else {
                            await player.back();
                        }
                    } finally {
                        player._isNavigating = false;
                    }
                } else if (message.type === 'toggle-filter') {
                    const filterName = String(message.filter || '').toLowerCase();
                    const def = FILTER_DEFS[filterName];
                    if (!def) throw new Error('Unknown filter');
                    const state = playerStates.get(session.guildId) || {};
                    state[filterName] = !state[filterName];
                    if (filterName === 'nightcore' && state.nightcore && state.vaporwave) state.vaporwave = false;
                    if (filterName === 'vaporwave' && state.vaporwave && state.nightcore) state.nightcore = false;
                    state._filterCooldownUntil = Date.now() + (process.env.RATE_RESPECT_AGGRO === 'true' ? 4000 : 1500);
                    playerStates.set(session.guildId, state);
                    if (state[filterName]) def.apply(player); else def.clear(player);
                    await player.filters.apply();
                } else if (message.type === 'add-related') {
                    const relatedTracks = relatedTracksCache.get(session.guildId);
                    const trackIndex = Number(message.index);
                    if (!relatedTracks || !relatedTracks.tracks[trackIndex]) throw new Error('Related track no longer available');
                    const trackData = relatedTracks.tracks[trackIndex];
                    let resolvedTrack = null;
                    const searchQuery = trackData.uri || `${trackData.title} ${trackData.author}`;
                    const searchResult = await searchWithRetry(null, searchQuery, session.user, null).catch(() => null);
                    if (searchResult?.tracks?.length) {
                        const normT = (trackData.title || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                        const normA = (trackData.author || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                        resolvedTrack = searchResult.tracks.find(t => {
                            const tN = (t.title || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                            const aN = (t.author || '').toLowerCase().replace(/[\s\-_()[\]【】]+/g, '');
                            return tN === normT && aN === normA;
                        }) || searchResult.tracks[0];
                        if (!resolvedTrack.userData) resolvedTrack.userData = {};
                        resolvedTrack.userData.requester = session.user;
                    }
                    if (!resolvedTrack) {
                        resolvedTrack = {
                            encoded: null,
                            info: {
                                title: trackData.title,
                                author: trackData.author || 'Unknown',
                                identifier: trackData.title,
                                uri: trackData.uri || null,
                                isSeekable: true,
                                isStream: false,
                                length: trackData.duration || 0,
                                sourceName: null
                            },
                            pluginInfo: {},
                            userData: { requester: session.user }
                        };
                    }
                    player.queue.add(resolvedTrack);
                    if (!player.playing && !player.paused) await player.play();
                    relatedTracks.tracks.splice(trackIndex, 1);
                    broadcastGuild(session.guildId);
                    return;
                } else throw new Error('Unknown Activity action');
                broadcastGuild(session.guildId);
            } catch (error) {
                sendJson(ws, { type: 'error', message: error.message || 'Activity request failed' });
            }
        });
    });

    const eventNames = ['trackStart', 'trackEnd', 'queueAdd', 'queueRemove', 'queueMoveRange', 'filtersUpdate', 'playerUpdate', 'playerPause'];
    eventNames.forEach(event => manager.on(event, player => {
        if (!player?.guildId) return;
        if (event === 'trackStart' && player.current) {
            precacheArtwork(player.current);
            if (player.queue.tracks[0]) precacheArtwork(player.queue.tracks[0]);
            const sources = getActivitySources(player.guildId);
            refreshRelatedTracks(player.guildId, player.current, sources).catch(() => { });
        }
        broadcastGuild(player.guildId);
    }));
    client.on('voiceStateUpdate', (oldState, newState) => {
        for (const session of sessions) {
            if (session.guildId !== newState.guild.id || session.user?.id !== newState.id) continue;
            const expectedVoiceChannelId = manager.players.get(session.guildId)?.voiceChannelId || session.channelId;
            if (newState.channelId === expectedVoiceChannelId) continue;
            const getBotName = () => process.env.BOT_NAME || 'Lunar';
            sendJson(session.ws, { type: 'error', message: `You left the Activity voice channel. Reopen ${getBotName()} from your current voice channel.` });
            session.ws.close(4003, 'Voice channel changed');
        }
    });
    setInterval(() => {
        for (const session of sessions) {
            if (!session.guildId) continue;
            const player = manager.players.get(session.guildId);
            if (!player || player.voiceChannelId === session.channelId) sendJson(session.ws, getSnapshot(session.guildId));
        }
    }, 1000).unref();

    const port = Number(process.env.ACTIVITY_PORT || 3001);
    const host = process.env.ACTIVITY_HOST || '0.0.0.0';
    server.listen(port, host, () => logger.info('activity_server_started', { host, port, secure: !allowInsecure }));
    return { server, broadcastGuild };
}
//
module.exports = { createActivityServer };
// contributors: @relentiousdragon