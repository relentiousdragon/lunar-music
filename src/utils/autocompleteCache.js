const CACHE_TTL_MS = 150 * 60 * 1000;
const USER_SEARCH_COOLDOWN_MS = 1200;
const cache = new Map();
const userSearches = new Map();
const selections = new Map();
//
function keyFor(source, query) {
    return `${source}:${query.trim().toLowerCase()}`;
}

function getCachedSuggestions(source, query) {
    const key = keyFor(source, query);
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.suggestions;
}

function cacheSuggestions(source, query, suggestions) {
    if (!suggestions?.length) return;
    cache.set(keyFor(source, query), { suggestions, expiresAt: Date.now() + CACHE_TTL_MS });
}

function createSelection(userId, payload) {
    const token = `lunar:${crypto.randomUUID()}`;
    selections.set(token, { userId, payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return token;
}

function consumeSelection(token, userId) {
    const selection = selections.get(token);
    if (!selection || selection.userId !== userId || Date.now() >= selection.expiresAt) return null;
    selections.delete(token);
    return selection.payload;
}

function canSearchAutocomplete(userId) {
    const now = Date.now();
    const previous = userSearches.get(userId) || 0;
    if (now - previous < USER_SEARCH_COOLDOWN_MS) return false;
    userSearches.set(userId, now);
    return true;
}

function pruneAutocompleteCache() {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now >= entry.expiresAt) cache.delete(key);
    }
    for (const [userId, timestamp] of userSearches) {
        if (now - timestamp > CACHE_TTL_MS) userSearches.delete(userId);
    }
    for (const [token, selection] of selections) {
        if (now >= selection.expiresAt) selections.delete(token);
    }
}

setInterval(pruneAutocompleteCache, 30 * 60 * 1000).unref();
//
module.exports = { CACHE_TTL_MS, getCachedSuggestions, cacheSuggestions, canSearchAutocomplete, createSelection, consumeSelection };
// contributors: @relentiousdragon
