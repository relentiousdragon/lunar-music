const fs = require('fs');
const { EmbedBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { getEmoji } = require('../utils/emojis');
const { getBotFooter } = require('../utils/branding');
//
async function executeTop(message) {
    const guild = message.guild;
    const channel = message.channel;
    const filePath = `./stats/${message.guild.id}.json`;
    if (!fs.existsSync(filePath)) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} No Stats`, 'No songs have been tracked in this server yet!', '#FFA500')] });
    }

    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const sorted = Object.values(data.totalPlays).sort((a, b) => b.count - a.count).slice(0, 10);

        if (sorted.length === 0) {
            return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} No Stats`, 'No songs have been tracked in this server yet!', '#FFA500')] });
        }

        const description = sorted.map((song, i) => `**${i + 1}.** ${song.title} - \`${song.count} plays\``).join('\n');
        const embed = new EmbedBuilder()
            .setTitle('Top 10 Songs - This Server')
            .setDescription(description)
            .setColor('#6A5ACD')
            .setFooter(getBotFooter());

        message.channel.send({ embeds: [embed] });
    } catch (e) {
        console.log(`[stats] top command error: ${e.message}`);
        message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Error`, 'Failed to fetch leaderboard.', '#FF0000')] });
    }
}

async function executeGlobal(message) {
    const guild = message.guild;
    const channel = message.channel;
    try {
        if (!fs.existsSync('./stats')) {
            return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} No Stats`, 'No songs have been tracked globally yet!', '#FFA500')] });
        }

        const files = fs.readdirSync('./stats').filter(f => f.endsWith('.json'));
        const aggregate = {};

        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(`./stats/${file}`, 'utf8'));
                for (const [id, song] of Object.entries(data.totalPlays)) {
                    if (!aggregate[id]) aggregate[id] = { count: 0, title: song.title };
                    aggregate[id].count += song.count;
                }
            } catch (e) { continue; }
        }

        const sorted = Object.values(aggregate).sort((a, b) => b.count - a.count).slice(0, 10);
        if (sorted.length === 0) {
            return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} No Stats`, 'No songs have been tracked globally yet!', '#FFA500')] });
        }

        const description = sorted.map((song, i) => `**${i + 1}.** ${song.title} - \`${song.count} plays\``).join('\n');
        const embed = new EmbedBuilder()
            .setTitle('Global Top 10 Songs')
            .setDescription(description)
            .setColor('#6A5ACD')
            .setFooter(getBotFooter());

        message.channel.send({ embeds: [embed] });
    } catch (e) {
        console.log(`[stats] global command error: ${e.message}`);
        message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Error`, 'Failed to fetch global leaderboard.', '#FF0000')] });
    }
}
//
module.exports = {
    top: { execute: executeTop, aliases: [] },
    global: { execute: executeGlobal, aliases: [] }
};
// contributors: @relentiousdragon