const { info, warn } = require('./logger');

const capabilities = {
    nodeLink: false,
    nodeType: 'unknown',
    sources: new Set(),
    unavailable: new Map()
};
//
function updateFromNode(node) {
    capabilities.nodeLink = Boolean(node?.isNodeLink);
    capabilities.nodeType = capabilities.nodeLink ? 'NodeLink' : 'Lavalink';
    const advertised = [...(node?.capabilities || [])]
        .filter(capability => capability.startsWith('source:'))
        .map(capability => capability.slice('source:'.length))
        .filter(Boolean);
    const fromInfo = Array.isArray(node?.info?.sourceManagers) ? node.info.sourceManagers : [];
    capabilities.sources = new Set(advertised.length ? advertised : fromInfo);

    capabilities.unavailable.clear();
    info('node_capabilities', {
        node: node?.identifier,
        nodeType: capabilities.nodeType,
        sources: [...capabilities.sources]
    });
    if (!capabilities.nodeLink) {
        warn('node_limited_capabilities', {
            node: node?.identifier,
            message: 'Connected standard Lavalink node, NodeLink-only search sources and filters are disabled.'
        });
    }
    return capabilities;
}

function resolveSourceName(platform) {
    const aliases = {
        youtube: ['ytsearch', 'youtube'],
        youtubemusic: ['ytmsearch', 'youtubemusic'],
        spotify: ['spsearch', 'spotify'],
        soundcloud: ['scsearch', 'soundcloud'],
        deezer: ['dzsearch', 'deezer'],
        applemusic: ['amsearch', 'applemusic'],
        tidal: ['tdsearch', 'tidal'],
        monochrome: ['mcsearch', 'monochrome']
    }[platform] || [platform];
    return aliases.find(source => capabilities.sources.has(source)) || platform;
}

function markUnavailable(source, reason) {
    capabilities.unavailable.set(source, reason);
    warn('source_unavailable', { source, reason });
}

function supports(source) {
    if (capabilities.nodeType === 'unknown') return true;
    if (capabilities.sources.size === 0) return !capabilities.unavailable.has(source);
    return getAliases(source).some(alias => capabilities.sources.has(alias)) && !capabilities.unavailable.has(source);
}

function getUnavailableReason(source) {
    return capabilities.unavailable.get(source);
}

function getAliases(source) {
    return {
        youtube: ['youtube', 'ytsearch'],
        ytsearch: ['youtube', 'ytsearch'],
        youtubemusic: ['youtubemusic', 'ytmsearch', 'youtube'],
        ytmsearch: ['youtubemusic', 'ytmsearch', 'youtube'],
        spotify: ['spotify', 'spsearch'],
        spsearch: ['spotify', 'spsearch'],
        soundcloud: ['soundcloud', 'scsearch'],
        scsearch: ['soundcloud', 'scsearch'],
        deezer: ['deezer', 'dzsearch'],
        dzsearch: ['deezer', 'dzsearch'],
        applemusic: ['applemusic', 'amsearch'],
        amsearch: ['applemusic', 'amsearch'],
        tidal: ['tidal', 'tdsearch'],
        tdsearch: ['tidal', 'tdsearch'],
        monochrome: ['monochrome', 'mcsearch'],
        mcsearch: ['monochrome', 'mcsearch']
    }[source] || [source];
}
//
module.exports = { capabilities, updateFromNode, resolveSourceName, markUnavailable, supports, getUnavailableReason };
// contributors: @relentiousdragon
