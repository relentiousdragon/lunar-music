const { EmbedBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const manager = require('../manager');
const { createEmbed } = require('../utils/embeds');
const { getFormattedDuration } = require('../utils/format');
const { getEmoji } = require('../utils/emojis');
const { getBotFooter } = require('../utils/branding');
//
async function executeSkip(message, args) {
    const guild = message.guild;
    const channel = message.channel;
    const skipPlayer = manager.players.get(message.guild.id);

    if (!skipPlayer || (!skipPlayer.current && skipPlayer.queue.tracks.length === 0)) {
        const connection = getVoiceConnection(message.guild.id);
        if (connection) connection.destroy();
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no music to skip!', '#FFA500')]
        });
    }

    if (!message.member.voice.channel || message.member.voice.channel.id !== skipPlayer.voiceChannelId) {
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Permission Denied`, 'You must be in the voice channel to use this command!', '#FF0000')]
        });
    }

    try {
        if (skipPlayer.queue.tracks.length === 0) {
            skipPlayer.queue.clear();
            skipPlayer.stop();
            message.channel.send({
                embeds: [createEmbed(`${getEmoji('checkmark', guild, channel)} Playback Stopped`, 'Stopped the current song as there was nothing next in queue', '#00FF00')]
            });
        } else {
            await skipPlayer.skip();
            message.channel.send({
                embeds: [createEmbed(`${getEmoji('checkmark', guild, channel)} Skipped`, 'Successfully skipped to the next track!', '#00FF00')]
            });
        }
    } catch (error) {
        message.channel.send({
            embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Error`, 'Could not skip track: ' + error.message, '#FF0000')]
        });
    }
}

async function executePrevious(message, args) {
    const guild = message.guild;
    const channel = message.channel;
    const prevPlayer = manager.players.get(message.guild.id);
    if (!prevPlayer) {
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no active player!', '#FFA500')]
        });
    }

    const history = prevPlayer.previous;
    if (!history || history.length === 0) {
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('star', guild, channel)} No History`, 'No previously played tracks!', '#FFA500')]
        });
    }

    const last10 = history.slice(-10).reverse();
    const description = last10.map((t, i) => `**${i + 1}.** ${t.author || 'Unknown'} - [${t.title}](${t.uri}) \`(${getFormattedDuration(t)})\``).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`${getEmoji('star', guild, channel)} Previously Played`)
        .setDescription(description)
        .setColor('#6A5ACD')
        .setFooter(getBotFooter(`${history.length} total in history • Use l.back to play previous`));

    message.channel.send({ embeds: [embed] });
}

async function executeBack(message, args) {
    const guild = message.guild;
    const channel = message.channel;
    const backPlayer = manager.players.get(message.guild.id);
    if (!backPlayer) {
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no active player!', '#FFA500')]
        });
    }

    if (!message.member.voice.channel || message.member.voice.channel.id !== backPlayer.voiceChannelId) {
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Permission Denied`, 'You must be in the voice channel!', '#FF0000')]
        });
    }

    const history = backPlayer.previous;
    if (!history || history.length === 0) {
        return message.channel.send({
            embeds: [createEmbed(`${getEmoji('star', guild, channel)} No History`, 'No previously played tracks to go back to!', '#FFA500')]
        });
    }

    try {
        await backPlayer.back();
        const prevTrack = backPlayer.current;
        message.channel.send({
            embeds: [createEmbed(
                `${getEmoji('checkmark', guild, channel)} Playing Previous`,
                prevTrack ? `Now playing: **${prevTrack.title}**` : 'Playing previous track!',
                '#00FF00'
            )]
        });
    } catch (error) {
        message.channel.send({
            embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Error`, 'Could not go back: ' + error.message, '#FF0000')]
        });
    }
}
//
module.exports = {
    skip: { execute: executeSkip, aliases: ['s'] },
    previous: { execute: executePrevious, aliases: ['pv'] },
    back: { execute: executeBack, aliases: ['b'] }
};
// contributors: @relentiousdragon