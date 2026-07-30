const { Manager, Connectors } = require('moonlink.js');
const client = require('./client');
const packageInfo = require('../package.json');
const { getBotName } = require('./utils/branding');
const logger = require('./utils/logger');
const { updateFromNode } = require('./utils/capabilities');
//
const CONNECTION_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

function applyReconnectCooldown(node, durationMs, reason) {
    const now = Date.now();
    const until = now + durationMs;
    node.lunarReconnectCooldownUntil = Math.max(node.lunarReconnectCooldownUntil || 0, until);

    if (node.lunarOriginalCalculateReconnectDelay) {
        scheduleReconnectAfterCooldown(node, reason);
        return;
    }
    node.lunarOriginalCalculateReconnectDelay = node.calculateReconnectDelay.bind(node);
    node.lunarOriginalConnect = node.connect.bind(node);
    node.calculateReconnectDelay = function calculateReconnectDelayWithCooldown() {
        const remaining = (this.lunarReconnectCooldownUntil || 0) - Date.now();
        if (remaining > 0) {
            logger.warn('node_reconnect_delayed', {
                node: this.identifier,
                delaySeconds: Math.ceil(remaining / 1000),
                reason
            });
            return remaining;
        }
        return this.lunarOriginalCalculateReconnectDelay();
    };
    node.connect = function connectWithCooldown(...args) {
        const remaining = (this.lunarReconnectCooldownUntil || 0) - Date.now();
        if (remaining > 0) {
            scheduleReconnectAfterCooldown(this, reason, args);
            return;
        }
        return this.lunarOriginalConnect(...args);
    };
    scheduleReconnectAfterCooldown(node, reason);
}

function scheduleReconnectAfterCooldown(node, reason, args = []) {
    const remaining = Math.max(0, (node.lunarReconnectCooldownUntil || 0) - Date.now());
    if (node.reconnectTimeout) clearTimeout(node.reconnectTimeout);
    if (remaining === 0) return;
    logger.warn('node_connection_blocked', {
        node: node.identifier,
        delaySeconds: Math.ceil(remaining / 1000),
        reason
    });
    node.reconnectTimeout = setTimeout(() => {
        node.reconnectTimeout = undefined;
        node.connect(...args);
    }, remaining);
}

function parseNodes() {
    const raw = process.env.NODELINK_NODES || process.env.LAVALINK_NODES || '';
    if (!raw.trim()) return [];

    return raw.split(';').map((entry, i) => {
        const parts = entry.split(',').map(s => s.trim());
        if (parts.length < 4) {
            console.log(`[manager] skipping malformed node entry: "${entry}"`);
            return null;
        }

        return {
            identifier: parts[0] || `node-${i}`,
            host: parts[1],
            port: parseInt(parts[2], 10) || 3000,
            password: parts[3],
            secure: parts[4] === 'true',
            priority: i + 1
        };
    }).filter(Boolean);
}

const nodes = parseNodes();

if (nodes.length === 0) {
    throw new Error('[manager] no NodeLink nodes configured; set NODELINK_NODES in your .env');
}
//
const manager = new Manager({
    nodes,
    options: {
        clientName: `${getBotName()}/${packageInfo.version}`,
        node: { autoMovePlayers: true },
        search: { defaultPlatform: 'soundcloud' },
        sources: { disabledSources: [] },
        spotify: {
            enabled: Boolean((process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) || process.env.SPOTIFY_ACCESS_TOKEN),
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            accessToken: process.env.SPOTIFY_ACCESS_TOKEN
        },
        defaultPlayer: { volume: 100, autoPlay: false, selfDeaf: true }
    }
});

manager.use(new Connectors.DiscordJs(), client);

manager.on('nodeError', (node, error) => {
    logger.error('node_error', { node: node.identifier, error: error.message });
});

manager.on('nodeConnected', (node) => {
    const cooldownRemaining = (node.lunarReconnectCooldownUntil || 0) - Date.now();
    if (cooldownRemaining > 0) {
        logger.warn('node_connection_rejected_during_cooldown', {
            node: node.identifier,
            delaySeconds: Math.ceil(cooldownRemaining / 1000)
        });
        node.socket?.close(4000, 'Reconnect cooldown active');
        return;
    }
    updateFromNode(node);
    const now = Date.now();
    if (!manager._lastSlashRegister || now - manager._lastSlashRegister > 30000) {
        setTimeout(() => {
            const { registerSlashCommands } = require('./events/interactionCreate');
            registerSlashCommands().catch(error => logger.warn('slash_source_refresh_failed', { error: error.message }));
            manager._lastSlashRegister = Date.now();
        }, 0);
    }
    logger.info('node_connected', { node: node.identifier, nodeLink: Boolean(node.isNodeLink) });
});

manager.on('nodeDisconnect', (node, code, reason) => {
    const disconnectReason = String(reason || 'unknown reason');
    logger.warn('node_disconnected', { node: node.identifier, code, reason: disconnectReason });
    if (Number(code) === 4000 && /too many websocket connections|connection attempts|try again later/i.test(disconnectReason)) {
        applyReconnectCooldown(node, CONNECTION_RATE_LIMIT_COOLDOWN_MS, 'Lavalink WebSocket connection rate limit');
        logger.warn('node_reconnect_cooldown', {
            node: node.identifier,
            delayMinutes: CONNECTION_RATE_LIMIT_COOLDOWN_MS / 60000,
            message: 'The node rate-limited this bot, reconnect is delayed to avoid extending the lockout.'
        });
    }
});

manager.on('nodeReconnecting', (node, attempt) => {
    logger.info('node_reconnecting', { node: node.identifier, attempt });
});

manager.on('playerConnected', player => logger.info('player_connected', {
    guild: player.guildId,
    node: player.node?.identifier
}));

manager.on('playerDisconnected', player => logger.info('player_disconnected', {
    guild: player.guildId,
    node: player.node?.identifier
}));
//
module.exports = manager;
// contributors: @relentiousdragon
