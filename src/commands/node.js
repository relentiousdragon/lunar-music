const manager = require('../manager');
const { createEmbed } = require('../utils/embeds');
const { isDeveloper } = require('../utils/permissions');
const { capabilities } = require('../utils/capabilities');
//
async function execute(message) {
    if (!isDeveloper(message)) {
        return message.channel.send({ content: 'Only configured bot developers can use this command.', ephemeral: Boolean(message.slash) });
    }
    const nodes = [...manager.nodes.nodes.values()];
    const nodeLines = nodes.length
        ? nodes.map(node => `• **${node.identifier}** — ${node.connected ? 'connected' : 'disconnected'} (${node.isNodeLink ? 'NodeLink' : 'Lavalink'})`).join('\n')
        : 'No configured nodes';
    const sources = capabilities.sources.size ? [...capabilities.sources].sort().join(', ') : 'not advertised';
    const unavailable = capabilities.unavailable.size
        ? [...capabilities.unavailable.entries()].map(([source, reason]) => `${source}: ${reason}`).join('\n').slice(0, 1024)
        : 'None';
    return message.channel.send({
        embeds: [createEmbed('Node Diagnostics', nodeLines, '#6A5ACD').addFields(
            { name: 'Advertised sources', value: `\`${sources.slice(0, 1000)}\`` },
            { name: 'Unavailable sources', value: unavailable }
        )],
        ...(message.slash ? { ephemeral: true } : {})
    });
}
//
module.exports = { execute, aliases: [] };
// contributors: @relentiousdragon