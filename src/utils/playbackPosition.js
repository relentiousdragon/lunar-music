const MAX_NODE_TIMESTAMP_AGE_MS = 10000;
const MAX_CLOCK_SKEW_MS = 120000;
//
function getNodePlaybackPosition(player, now = Date.now()) {
    const track = player?.current;
    const position = Number(track?.position);
    const timestamp = Number(track?.time);
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(timestamp) || timestamp <= 0) return null;

    const age = now - timestamp;
    if (age < -MAX_CLOCK_SKEW_MS || age > MAX_NODE_TIMESTAMP_AGE_MS) return null;

    const elapsed = Math.max(0, age);
    const duration = Number(track.duration);
    const estimated = position + elapsed;
    return Number.isFinite(duration) && duration > 0 ? Math.min(estimated, duration) : estimated;
}
//
module.exports = { getNodePlaybackPosition, MAX_NODE_TIMESTAMP_AGE_MS };
// contributors: @relentiousdragon