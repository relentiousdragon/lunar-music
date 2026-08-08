const MAX_NODE_TIMESTAMP_AGE_MS = 10000;
const MAX_CLOCK_SKEW_MS = 120000;
const DIRECT_NODE_REFRESH_MS = 30000;
const ZERO_POSITION_MS = 1000;
const RESET_GUARD_POSITION_MS = 45000;
//
function estimateNodePlaybackPosition(positionValue, timestampValue, durationValue, now = Date.now()) {
    const position = Number(positionValue);
    const timestamp = Number(timestampValue);
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(timestamp) || timestamp <= 0) return null;

    const age = now - timestamp;
    if (age < -MAX_CLOCK_SKEW_MS || age > MAX_NODE_TIMESTAMP_AGE_MS) return null;

    const elapsed = Math.max(0, age);
    const duration = Number(durationValue);
    const estimated = position + elapsed;
    return Number.isFinite(duration) && duration > 0 ? Math.min(estimated, duration) : estimated;
}

function getMoonlinkPlaybackPosition(player, now = Date.now()) {
    const track = player?.current;
    return estimateNodePlaybackPosition(track?.position, track?.time, track?.duration, now);
}

function getDirectNodePlaybackPosition(player, state, now = Date.now()) {
    const remote = state?.directNodePlayback;
    return estimateNodePlaybackPosition(remote?.position, remote?.timestamp, player?.current?.duration, now);
}

function canSynchronizeWatchdog(watchdogPosition, nodePosition, clockAdvanced = false) {
    if (clockAdvanced && nodePosition < watchdogPosition - 3000) {
        return false;
    }
    return !(nodePosition <= ZERO_POSITION_MS && watchdogPosition >= RESET_GUARD_POSITION_MS);
}

async function refreshDirectNodePlayback(player, state, now = Date.now()) {
    if (!player?.node?.rest?.getPlayer || !state || state.directNodePlaybackRequest) return;
    if (now - (state.directNodePlaybackFetchAt || 0) < DIRECT_NODE_REFRESH_MS) return;
    state.directNodePlaybackFetchAt = now;
    state.directNodePlaybackRequest = true;
    try {
        const remotePlayer = await player.node.rest.getPlayer(player.guildId);
        const remoteState = remotePlayer?.state;
        if (Number.isFinite(Number(remoteState?.position)) && Number.isFinite(Number(remoteState?.time))) {
            state.directNodePlayback = { position: remoteState.position, timestamp: remoteState.time };
        }
    } catch (error) {
        console.log(`[lyrics] direct node position sync failed for ${player.guildId}: ${error.message}`);
    } finally {
        state.directNodePlaybackRequest = false;
    }
}
//
module.exports = { estimateNodePlaybackPosition, getMoonlinkPlaybackPosition, getDirectNodePlaybackPosition, refreshDirectNodePlayback, canSynchronizeWatchdog, MAX_NODE_TIMESTAMP_AGE_MS, DIRECT_NODE_REFRESH_MS };
// contributors: @relentiousdragon
