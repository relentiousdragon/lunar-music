const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBotName, getBotFooter } = require('../utils/branding');

const REPOSITORY_URL = 'https://github.com/relentiousdragon/lunar-music';
//
async function execute(message) {
    const embed = new EmbedBuilder()
        .setTitle(`${getBotName()} Credits`)
        .setDescription('Created by [relentiousdragon](https://github.com/relentiousdragon).\n\nIf you liked this bot, consider starring the repository on GitHub.')
        .setColor('#6A5ACD')
        .setFooter(getBotFooter());
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Star').setStyle(ButtonStyle.Link).setURL(REPOSITORY_URL)
    );
    return message.channel.send({ embeds: [embed], components: [row] });
}
//
module.exports = { execute, aliases: [] };
// contributors: @relentiousdragom