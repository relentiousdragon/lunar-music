const manager = require('../manager');
const { searchFailures } = require('../state');
const logger = require('./logger');
const { capabilities, supports, markUnavailable, getUnavailableReason } = require('./capabilities');

const SOURCE_ORDER = ['spotify', 'tdsearch', 'soundcloud', 'amsearch', 'deezer'];
const DISALLOWED_QUERY = /(youtube\.com|youtu\.be|ytsearch:|youtube:)/i;
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

async function searchOnce(query, requester, source) {
    const options = { query, requester: requesterId(requester) };
    if (source) options.source = source;
    return Promise.race([
        manager.search(options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('search timeout after 20s')), 20000))
    ]);
}

async function searchWithRetry(player, query, requester, source = null) {
    if (DISALLOWED_QUERY.test(query)) {
        console.log(`[search] blocked disallowed video platform query from ${requesterId(requester)}`);
        return { loadType: 'empty', tracks: [], isEmpty: true, error: 'Video platform playback is disabled' };
    }

    if (capabilities.nodeType === 'Lavalink' && !/^https?:\/\//i.test(query)) {
        const error = new Error('Text search is unavailable on standard Lavalink. Please provide a direct supported-source URL or use a NodeLink node.');
        logger.warn('search_unavailable', { nodeType: capabilities.nodeType, query, reason: error.message });
        return { loadType: 'error', tracks: [], error };
    }

    const sources = source ? [source] : (/^https?:\/\//i.test(query) ? [null] : SOURCE_ORDER);
    let lastResult = { loadType: 'empty', tracks: [] };

    for (const currentSource of sources) {
        if (currentSource && !supports(currentSource)) {
            const reason = getUnavailableReason(currentSource) || 'unsupported by the connected node';
            logger.warn('search_source_skipped', { source: currentSource, reason, query });
            lastResult = { loadType: 'error', tracks: [], error: new Error(`${currentSource} search unavailable on this node`) };
            continue;
        }
        try {
            logger.info('search_started', { source: currentSource || 'direct', query });
            const result = filterTracks(await searchOnce(query, requester, currentSource));
            logger.info('search_response', {
                source: currentSource || 'direct',
                query,
                loadType: result?.loadType,
                trackCount: result?.tracks?.length || 0
            });
            if (hasTracks(result)) return result;
            lastResult = result || lastResult;
        } catch (error) {
            const message = error.message || String(error);
            if (/NodeLink-only|403|404|unknown source|unsupported/i.test(message) && currentSource) {
                markUnavailable(currentSource, message);
            }
            logger.warn('search_failed', { source: currentSource || 'direct', query, error: message });
            lastResult = { loadType: 'error', tracks: [], error };
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
module.exports = { searchWithRetry, SOURCE_ORDER, filterTracks };
// contributors: @relentiousdragon
