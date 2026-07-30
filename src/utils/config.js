function validateEnvironment(env = process.env) {
    const errors = [];
    const warnings = [];
    if (!env.DISCORD_TOKEN?.trim()) errors.push('DISCORD_TOKEN is missing');
    if (!env.DEV_USER_IDS?.trim()) warnings.push('DEV_USER_IDS is empty, l.sr is disabled');

    const rawNodes = env.NODELINK_NODES || env.LAVALINK_NODES;
    if (!rawNodes?.trim()) {
        errors.push('NODELINK_NODES or LAVALINK_NODES is missing');
    } else {
        rawNodes.split(';').forEach((entry, index) => {
            const [identifier, host, port, password, secure] = entry.split(',').map(value => value.trim());
            if (!identifier || !host || !port || !password) {
                errors.push(`node ${index + 1} must contain identifier, host, port, and password`);
            } else if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
                errors.push(`node ${identifier} has an invalid port`);
            } else if (secure && !['true', 'false'].includes(secure.toLowerCase())) {
                errors.push(`node ${identifier} secure must be true or false`);
            }
        });
    }

    if ((env.SPOTIFY_CLIENT_ID && !env.SPOTIFY_CLIENT_SECRET) ||
        (!env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET)) {
        errors.push('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be provided together');
    }
    if (!env.BOT_NAME?.trim()) warnings.push('BOT_NAME is not set, using Lunar');
    if (!env.BOT_PREFIXES?.trim()) warnings.push('BOT_PREFIXES is not set, using ln.,l.');
    if (env.ACTIVITY_ENABLED === 'true') {
        if (!env.ACTIVITY_DISCORD_CLIENT_ID?.trim() || !env.ACTIVITY_DISCORD_CLIENT_SECRET?.trim() || !env.ACTIVITY_REDIRECT_URI?.trim()) {
            errors.push('Activity requires ACTIVITY_DISCORD_CLIENT_ID, ACTIVITY_DISCORD_CLIENT_SECRET, and ACTIVITY_REDIRECT_URI');
        }
        if (env.ACTIVITY_ALLOW_INSECURE_LOCAL !== 'true' && (!env.ACTIVITY_TLS_KEY_PATH?.trim() || !env.ACTIVITY_TLS_CERT_PATH?.trim())) {
            errors.push('Activity requires ACTIVITY_TLS_KEY_PATH and ACTIVITY_TLS_CERT_PATH unless ACTIVITY_ALLOW_INSECURE_LOCAL=true');
        }
    }
    return { errors, warnings, valid: errors.length === 0 };
}
//
module.exports = { validateEnvironment };
// contributors: @relentiousdragon
