const { Manager } = require('moonlink.js');
//
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
    console.log('[manager] no nodelink nodes configured - set NODELINK_NODES in your .env');
}
//
const manager = new Manager({
    nodes,
    options: {
        clientName: 'Lunar/1.0.0',
        reconnectAttempts: 5,
        reconnectDelay: 10000,
        defaultPlayer: {
            volume: 100,
            selfDeaf: true,
            autoPlay: false
        },
        node: {
            movePlayersOnDisconnect: true
        }
    },
    moonlink: {
        options: {
            clientName: 'Lunar/1.0.0',
            node: {
                autoMovePlayers: true,
                retryAmount: 10,
                retryDelay: 5000
            },
            defaultPlayer: {
                autoPlay: false,
                selfDeaf: true
            }
        }
    }
});

manager.on('nodeError', (node, error) => {
    console.log(`[manager] node ${node.identifier} error: ${error.message}`);
});

manager.on('nodeConnect', (node) => {
    console.log(`[manager] node ${node.identifier} connected`);
});

manager.on('nodeDisconnect', (node, reason) => {
    console.log(`[manager] node ${node.identifier} disconnected: ${reason || 'unknown reason'}`);
});

manager.on('nodeReconnect', (node) => {
    console.log(`[manager] node ${node.identifier} reconnecting`);
});
//
module.exports = manager;
// contributors: @relentiousdragon