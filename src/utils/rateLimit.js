const buckets = new Map();

const LIMITS = {
    play: [4, 30000],
    skip: [3, 10000],
    seek: [3, 15000],
    filter: [4, 15000]
};
//
function keyFor(context, command) {
    return `${context.author?.id || context.user?.id || 'unknown'}:${context.guild?.id || 'dm'}:${command}`;
}

function checkRateLimit(context, command) {
    const limit = LIMITS[command];
    if (!limit) return 0;
    const [max, windowMs] = limit;
    const now = Date.now();
    const key = keyFor(context, command);
    const bucket = (buckets.get(key) || []).filter(timestamp => now - timestamp < windowMs);
    if (bucket.length >= max) {
        buckets.set(key, bucket);
        return windowMs - (now - bucket[0]);
    }
    bucket.push(now);
    buckets.set(key, bucket);
    return 0;
}

function resetRateLimits() {
    buckets.clear();
}
//
module.exports = { LIMITS, checkRateLimit, resetRateLimits };
// contributors: @relentiousdragon