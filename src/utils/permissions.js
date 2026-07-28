function canControlPlayer(message, player) {
    return Boolean(
        message?.member?.voice?.channel &&
        player?.voiceChannelId &&
        message.member.voice.channel.id === player.voiceChannelId
    );
}

function getDeveloperIds(env = process.env) {
    return new Set((env.DEV_USER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean));
}

function isDeveloper(message, env = process.env) {
    const userId = message?.author?.id || message?.user?.id;
    return Boolean(userId && getDeveloperIds(env).has(userId));
}
//
module.exports = { canControlPlayer, getDeveloperIds, isDeveloper };
// contributors: @relentiousdragon