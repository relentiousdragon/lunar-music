const { PermissionsBitField } = require('discord.js');
const manager = require('../manager');
const client = require('../client');
const { playerStates } = require('../state');
const { createEmbed } = require('../utils/embeds');
const { formatTime } = require('../utils/format');
const { setVoiceChannelStatus } = require('../utils/voice');
const { sendSessionSummary } = require('../handlers/trackEnd');
const { getEmoji } = require('../utils/emojis');
const SET_VOICE_STATUS = BigInt(1) << BigInt(48);
//
async function executePause(message) {
    const guild = message.guild;
    const channel = message.channel;
    const pausePlayer = manager.players.get(message.guild.id);
    if (!pausePlayer || !pausePlayer.current) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no music to pause!', '#FFA500')] });
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== pausePlayer.voiceChannelId) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Permission Denied`, 'You must be in the voice channel!', '#FF0000')] });
    }
    if (pausePlayer.paused) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Already Paused`, 'The player is already paused!', '#FFA500')] });
    }
    pausePlayer.pause();
    message.channel.send({ embeds: [createEmbed(`${getEmoji('checkmark', guild, channel)} Paused`, 'Playback has been paused.', '#00FF00')] });
}

async function executeResume(message) {
    const guild = message.guild;
    const channel = message.channel;
    const resumePlayer = manager.players.get(message.guild.id);
    if (!resumePlayer || !resumePlayer.current) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no music to resume!', '#FFA500')] });
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== resumePlayer.voiceChannelId) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Permission Denied`, 'You must be in the voice channel!', '#FF0000')] });
    }
    if (!resumePlayer.paused) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Not Paused`, 'The player is not paused!', '#FFA500')] });
    }
    resumePlayer.resume();
    message.channel.send({ embeds: [createEmbed(`${getEmoji('checkmark', guild, channel)} Resumed`, 'Playback has been resumed.', '#00FF00')] });
}

async function executeStop(message) {
    const guild = message.guild;
    const channel = message.channel;
    try {
        const stopPlayer = manager.players.get(message.guild.id);
        let vcChannel = null;

        if (stopPlayer) {
            vcChannel = client.channels.cache.get(stopPlayer.voiceChannelId);
            if (stopPlayer.current && vcChannel?.permissionsFor(client.user)?.has(SET_VOICE_STATUS)) {
                await setVoiceChannelStatus(vcChannel, '').catch(() => { });
            }
        }

        if (!message.member.voice.channel) {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.channel.send({
                    embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Permission Denied`, 'You need to be in the voice channel!', '#FF0000')]
                });
            }
        }

        if (!stopPlayer) {
            return message.channel.send({
                embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no music to stop!', '#FFA500')]
            });
        }

        await sendSessionSummary(message.guild.id);
        playerStates.delete(message.guild.id);
        await stopPlayer.destroy();

        message.channel.send({
            embeds: [createEmbed(`${getEmoji('cd', guild, channel)} Stopped`, 'Playback stopped and queue cleared', '#00FF00')]
        });
    } catch (error) {
        console.log(`[stop] error: ${error.message}`);
        message.channel.send({
            embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Error`, 'Could not stop playback: ' + error.message, '#FF0000')]
        });
    }
}

async function executeSeek(message, args) {
    const guild = message.guild;
    const channel = message.channel;
    const seekPlayer = manager.players.get(message.guild.id);
    if (!seekPlayer || !seekPlayer.current) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no music playing!', '#FFA500')] });
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== seekPlayer.voiceChannelId) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Permission Denied`, 'You must be in the voice channel!', '#FF0000')] });
    }
    if (!seekPlayer.current.isSeekable) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Not Seekable`, 'This track does not support seeking!', '#FF0000')] });
    }

    const position = args[0];
    if (!position) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Missing Position`, 'Please provide a time to seek to! Example: `l.seek 1:30`', '#FF0000')] });
    }

    let milliseconds = 0;
    if (position.includes(':')) {
        const parts = position.split(':');
        if (parts.length === 3) {
            const [hours, minutes, seconds] = parts.map(Number);
            milliseconds = ((hours * 3600) + (minutes * 60) + seconds) * 1000;
        } else {
            const [minutes, seconds] = parts.map(Number);
            milliseconds = ((minutes * 60) + seconds) * 1000;
        }
    } else {
        milliseconds = parseInt(position) * 1000;
    }

    if (isNaN(milliseconds) || milliseconds < 0) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Invalid Format`, 'Use format like `1:30` or `1:05:30`', '#FF0000')] });
    }

    const trackLength = seekPlayer.current.duration || 0;
    if (milliseconds > trackLength) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Invalid Position`, `Track is only **${formatTime(trackLength)}** long!`, '#FF0000')] });
    }

    const seekState = playerStates.get(message.guild.id);
    const now = Date.now();
    const SEEK_COOLDOWN = 5000;

    if (seekState?.lastSeekTime && (now - seekState.lastSeekTime) < SEEK_COOLDOWN) {
        const remaining = Math.ceil((SEEK_COOLDOWN - (now - seekState.lastSeekTime)) / 1000);
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Seek Cooldown`, `Please wait **${remaining}s** before seeking again!`, '#FFA500')] });
    }

    seekPlayer.seek(milliseconds);
    if (seekState) {
        seekState.manualPos = milliseconds;
        seekState.lastWatchdogUpdate = now;
        seekState.lastSeekTime = now;
    }
    message.channel.send({ embeds: [createEmbed(`${getEmoji('checkmark', guild, channel)} Seeked`, `Jumped to **${formatTime(milliseconds)}**`, '#00FF00')] });
}

async function executeLoop(message, args) {
    const guild = message.guild;
    const channel = message.channel;
    const loopPlayer = manager.players.get(message.guild.id);
    if (!loopPlayer || !loopPlayer.current) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no music playing to loop!', '#FFA500')] });
    }

    const mode = args[0]?.toLowerCase();
    let modeValue;
    let modeText;

    switch (mode) {
        case 'track':
        case 'song':
            modeValue = 'track';
            modeText = 'Track';
            break;
        case 'queue':
            modeValue = 'queue';
            modeText = 'Queue';
            break;
        case 'off':
        case 'stop':
            modeValue = 'off';
            modeText = 'Off';
            break;
        default:
            const currentMode = loopPlayer.loop;
            if (currentMode === 'off') { modeValue = 'track'; modeText = 'Track'; }
            else if (currentMode === 'track') { modeValue = 'queue'; modeText = 'Queue'; }
            else { modeValue = 'off'; modeText = 'Off'; }
    }

    loopPlayer.setLoop(modeValue);
    message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} Loop Mode`, `Set loop mode to **${modeText}**`, '#00FF00')] });
}

async function executeClear(message) {
    const guild = message.guild;
    const channel = message.channel;
    const clearPlayer = manager.players.get(message.guild.id);
    if (!clearPlayer) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no queue to clear!', '#FFA500')] });
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== clearPlayer.voiceChannelId) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Permission Denied`, 'You must be in the voice channel!', '#FF0000')] });
    }

    const clearedCount = clearPlayer.queue.tracks.length;
    clearPlayer.queue.clear();
    clearPlayer.stop();

    message.channel.send({ embeds: [createEmbed(`${getEmoji('checkmark', guild, channel)} Queue Cleared`, `Cleared **${clearedCount}** tracks and stopped playback.`, '#00FF00')] });
}

async function executeRestart(message) {
    const guild = message.guild;
    const channel = message.channel;
    const restartPlayer = manager.players.get(message.guild.id);
    if (!restartPlayer) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('star', guild, channel)} Nothing Playing`, 'There is no active player to restart!', '#FFA500')] });
    }
    if (!message.member.voice.channel || message.member.voice.channel.id !== restartPlayer.voiceChannelId) {
        return message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Permission Denied`, 'You must be in the voice channel!', '#FF0000')] });
    }

    try {
        const state = playerStates.get(message.guild.id);
        const savedPos = state?.manualPos || 0;
        await restartPlayer.restart();

        if (state) {
            state.recoveryRestarted = true;
            state.manualPos = savedPos;
            state.pos = savedPos;
            state.lastWatchdogUpdate = Date.now();
            state.timestamp = Date.now();
        }

        message.channel.send({ embeds: [createEmbed(`${getEmoji('checkmark', guild, channel)} Restarted`, 'Player has been restarted. This may help with connection issues.', '#00FF00')] });
    } catch (error) {
        message.channel.send({ embeds: [createEmbed(`${getEmoji('xmark', guild, channel)} Error`, 'Could not restart player: ' + error.message, '#FF0000')] });
    }
}
//
module.exports = {
    pause: { execute: executePause, aliases: ['ps'] },
    resume: { execute: executeResume, aliases: ['rs', 'unpause'] },
    stop: { execute: executeStop, aliases: ['st'] },
    seek: { execute: executeSeek, aliases: ['sek', 'jump', 'goto'] },
    loop: { execute: executeLoop, aliases: ['r', 'rp', 'repeat'] },
    clear: { execute: executeClear, aliases: ['skipall', 'sa', 'clearqueue', 'cq'] },
    restart: { execute: executeRestart, aliases: ['fix'] }
};
// contributors: @relentiousdragon