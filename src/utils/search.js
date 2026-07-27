const manager = require('../manager');
const { searchFailures } = require('../state');
const logger = require('./logger');
const { capabilities, resolveSourceName, supports, markUnavailable, getUnavailableReason } = require('./capabilities');

const DISALLOWED_QUERY = /(youtube\.com|youtu\.be|ytsearch:|youtube:)/i;
const DISALLOWED_SOURCES = new Set(['youtube', 'youtubemusic', 'ytsearch', 'ytmsearch']);
const NON_SEARCH_SOURCES = new Set(['http', 'local']);
const SUPPORTED_SOURCE_FAMILIES = new Set(['spotify', 'spsearch', 'deezer', 'dzsearch', 'applemusic', 'amsearch', 'tidal', 'tdsearch', 'soundcloud', 'scsearch']);
const SEARCH_PREFIXES = new Map([
    ['spotify', 'spsearch'], ['spsearch', 'spsearch'],
    ['soundcloud', 'scsearch'], ['scsearch', 'scsearch'],
    ['deezer', 'dzsearch'], ['dzsearch', 'dzsearch'],
    ['applemusic', 'amsearch'], ['amsearch', 'amsearch'],
    ['tidal', 'tdsearch'], ['tdsearch', 'tdsearch']
]);
//
function requesterId(requester) {
    return requester?.id || (typeof requester === 'string' ? requester : 'unknown');
}

function hasTracks(result) {
    return Boolean(result && result.loadType !== 'error' && result.loadType !== 'empty' && result.tracks?.length);
}

function filterTracks(result) {
    if (!result?.tracks) return result;
    result.tracks = result.tracks.filter(track => !DISALLOWED_QUERY.test(track.uri || track.url || ''));
    if (result.tracks.length === 0) result.loadType = 'empty';
    return result;
}

function getSourceOrder() {
    const nodeSources = [...capabilities.sources].filter(source => {
        const normalized = source.toLowerCase();
        return SUPPORTED_SOURCE_FAMILIES.has(normalized) &&
            !DISALLOWED_SOURCES.has(normalized) && !NON_SEARCH_SOURCES.has(normalized);
    });
    const nativeFallbacks = [];
    if (typeof manager.isSpotifyEnabled === 'function' && manager.isSpotifyEnabled()) nativeFallbacks.push('spsearch');
    if (typeof manager.isDeezerEnabled === 'function' && manager.isDeezerEnabled()) nativeFallbacks.push('dzsearch');
    const seenFamilies = new Set();
    return [...nodeSources, ...nativeFallbacks].filter(source => {
        const family = sourceFamily(source);
        if (seenFamilies.has(family)) return false;
        seenFamilies.add(family);
        return true;
    });
}

function sourceFamily(source) {
    const aliases = {
        spotify: ['spotify', 'spsearch'], spsearch: ['spotify', 'spsearch'],
        soundcloud: ['soundcloud', 'scsearch'], scsearch: ['soundcloud', 'scsearch'],
        deezer: ['deezer', 'dzsearch'], dzsearch: ['deezer', 'dzsearch'],
        applemusic: ['applemusic', 'amsearch'], amsearch: ['applemusic', 'amsearch'],
        tidal: ['tidal', 'tdsearch'], tdsearch: ['tidal', 'tdsearch']
    }[source] || [source];
    return aliases.slice().sort().join('|');
}

function isConfiguredNativeSource(source) {
    return (source === 'spsearch' && typeof manager.isSpotifyEnabled === 'function' && manager.isSpotifyEnabled()) ||
        (source === 'dzsearch' && typeof manager.isDeezerEnabled === 'function' && manager.isDeezerEnabled());
}

function sourceCandidates(source) {
    const aliases = {
        spotify: ['spotify', 'spsearch'], spsearch: ['spsearch', 'spotify'],
        soundcloud: ['soundcloud', 'scsearch'], scsearch: ['scsearch', 'soundcloud'],
        deezer: ['deezer', 'dzsearch'], dzsearch: ['dzsearch', 'deezer'],
        applemusic: ['applemusic', 'amsearch'], amsearch: ['amsearch', 'applemusic'],
        tidal: ['tidal', 'tdsearch'], tdsearch: ['tdsearch', 'tidal']
    }[source] || [source];
    const advertised = aliases.filter(candidate => capabilities.sources.has(candidate));
    return advertised.length ? advertised : [source];
}

function describeError(error) {
    const status = error?.statusCode || error?.status || error?.response?.status;
    const body = error?.body || error?.response?.data;
    const detail = typeof body === 'string' ? body : body?.message || body?.error;
    return {
        message: error?.message || String(error),
        status: status ? Number(status) : undefined,
        detail: detail || undefined,
        cause: error?.cause?.message || undefined
    };
}

async function searchOnce(query, requester, source) {
    const options = { query, requester: requesterId(requester) };
    if (source) options.source = source;
    const node = manager.nodes.findNode();
    const isDirectNodeSearch = Boolean(node && !node.isNodeLink && source && SEARCH_PREFIXES.has(source));
    const identifier = isDirectNodeSearch ? `${SEARCH_PREFIXES.get(source)}:${query}` : undefined;
    logger.debug('search_transport', {
        source: source || 'direct',
        transport: isDirectNodeSearch ? 'standard_lavalink_rest' : 'moonlink_manager',
        node: node?.identifier,
        nodeType: node?.isNodeLink ? 'NodeLink' : 'Lavalink',
        identifier
    });
    const searchPromise = isDirectNodeSearch ? node.rest.loadTracks(identifier) : manager.search(options);
    return Promise.race([
        searchPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('search timeout after 20s')), 20000))
    ]);
}

async function searchWithRetry(player, query, requester, source = null) {
    if (DISALLOWED_QUERY.test(query)) {
        console.log(`[search] blocked disallowed video platform query from ${requesterId(requester)}`);
        return { loadType: 'empty', tracks: [], isEmpty: true, error: 'Video platform playback is disabled' };
    }

    const sources = source ? [source] : (/^https?:\/\//i.test(query) ? [null] : getSourceOrder());
    let lastResult = { loadType: 'empty', tracks: [] };
    const attemptedFamilies = new Set();

    for (const requestedSource of sources) {
        for (const currentSource of sourceCandidates(requestedSource)) {
            const family = sourceFamily(currentSource || 'direct');
            if (attemptedFamilies.has(family)) continue;
            attemptedFamilies.add(family);

            if (currentSource && !SUPPORTED_SOURCE_FAMILIES.has(currentSource.toLowerCase())) {
                logger.warn('search_source_skipped', {
                    source: currentSource,
                    requestedSource,
                    reason: 'source is not supported by this bot',
                    supportedSources: ['applemusic', 'deezer', 'spotify', 'tidal', 'soundcloud'],
                    query
                });
                lastResult = { loadType: 'error', tracks: [], error: new Error(`${currentSource} is not supported by this bot`) };
                continue;
            }

            if (currentSource && DISALLOWED_SOURCES.has(currentSource.toLowerCase())) {
                logger.warn('search_source_skipped', { source: currentSource, reason: 'disabled by bot policy', query });
                lastResult = { loadType: 'error', tracks: [], error: new Error(`${currentSource} search is disabled`) };
                continue;
            }
            if (currentSource && !supports(currentSource) && !isConfiguredNativeSource(currentSource)) {
                const reason = getUnavailableReason(currentSource) || 'unsupported by the connected node';
                logger.warn('search_source_skipped', { source: currentSource, requestedSource, reason, query });
                lastResult = { loadType: 'error', tracks: [], error: new Error(`${currentSource} search unavailable on this node`) };
                continue;
            }

            try {
                logger.info('search_started', { source: currentSource || 'direct', requestedSource, query });
                const result = filterTracks(await searchOnce(query, requester, currentSource));
                logger.info('search_response', {
                    source: currentSource || 'direct',
                    requestedSource,
                    query,
                    loadType: result?.loadType,
                    trackCount: result?.tracks?.length || 0,
                    firstTrackSource: result?.tracks?.[0]?.sourceName,
                    firstTrackUri: result?.tracks?.[0]?.uri
                });
                if (hasTracks(result)) return result;
                lastResult = result || lastResult;
            } catch (error) {
                const details = describeError(error);
                const message = details.message;
                if ((details.status === 403 || details.status === 404 || /NodeLink-only|403|404|unknown source|unsupported/i.test(message)) && currentSource) {
                    markUnavailable(currentSource, message);
                }
                logger.warn('search_failed', {
                    source: currentSource || 'direct',
                    requestedSource,
                    query,
                    ...details,
                    explanation: details.status === 403
                        ? 'The Lavalink provider refused this request; commonly source/plugin blocking, provider policy, or invalid node credentials.'
                        : undefined
                });
                lastResult = { loadType: 'error', tracks: [], error };
            }
        }
    }

    searchFailures.push(Date.now());
    while (searchFailures.length && Date.now() - searchFailures[0] > 120000) searchFailures.shift();
    if (searchFailures.length >= 2) {
        manager.nodes.nodes.forEach(node => {
            Promise.resolve(node.reconnect()).catch(() => { });
        });
        searchFailures.length = 0;
    }
    return lastResult;
}
//
module.exports = { searchWithRetry, getSourceOrder, resolveSourceName, filterTracks };
// contributors: @relentiousdragon
