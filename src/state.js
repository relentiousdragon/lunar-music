const voiceTimeouts = new Map();
const activeQueues = new Map();
const playerStates = new Map();
const selectionCollectors = new Map();
const colorCache = new Map();
const stallHistory = new Map();
const searchFailures = [];
const activeLyricsPlayers = new Set();
//
function isSyncedLyricsEnabled() {
    if (process.env.SYNCED_LYRICS_ENABLED === 'false') return false;
    const max = getMaxSyncedLyricsPlayers();
    return max > 0;
}

function getMaxSyncedLyricsPlayers() {
    const val = parseInt(process.env.MAX_SYNCED_LYRICS_PLAYERS, 10);
    if (isNaN(val) || val < 0) return 5;
    return Math.min(val, 20);
}

function canAcquireLyricsSlot(guildId) {
    if (!isSyncedLyricsEnabled()) return false;
    if (activeLyricsPlayers.has(guildId)) return true;
    return activeLyricsPlayers.size < getMaxSyncedLyricsPlayers();
}

function acquireLyricsSlot(guildId) {
    if (!canAcquireLyricsSlot(guildId)) return false;
    activeLyricsPlayers.add(guildId);
    return true;
}

function releaseLyricsSlot(guildId) {
    activeLyricsPlayers.delete(guildId);
}
//
module.exports = {
    voiceTimeouts,
    activeQueues,
    playerStates,
    selectionCollectors,
    colorCache,
    stallHistory,
    searchFailures,
    activeLyricsPlayers,
    isSyncedLyricsEnabled,
    getMaxSyncedLyricsPlayers,
    canAcquireLyricsSlot,
    acquireLyricsSlot,
    releaseLyricsSlot
};
// contributors: @relentiousdragon