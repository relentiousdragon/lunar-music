const { PermissionsBitField } = require('discord.js');
//
const EMOJIS = {
    vinyl: '<a:vinyl:1531203938265727076>',
    settings: '<a:settings:1531207847507922984>',
    loading: '<a:loading:1531207647385096254>',
    cd: '<a:cd:1531203989671116861>',
    xmark: '<:xmark:1531207526056726618>',
    tidal: '<:tidal:1531204221490303046>',
    star: '<:star:1531207799546052659>',
    spotify: '<:spotify:1531204134748033054>',
    soundcloud: '<:soundcloud:1531204042133471322>',
    right: '<:right:1531203875648831568>',
    reply_cont: '<:reply_cont:1531207607950250075>',
    reply: '<:reply:1531207567802630295>',
    headphones: '<:headphones:1531204181581496350>',
    deezer: '<:deezer:1531204080792244315>',
    checkmark: '<:checkmark:1531207492615405578>',
    apple_music: '<:apple_music:1531204265362591864>',
};
const FALLBACKS = {
    spotify: '🎧',
    soundcloud: '🎧',
    deezer: '🎧',
    apple_music: '🎧',
    tidal: '🎧',
    headphones: '🎧',
    checkmark: '✅',
    xmark: '❌',
    warning: '⚠️',
    question: '❓',
    loading: '⌛',
    cd: '💿',
    vinyl: '💿',
    right: '▶️',
    star: '⭐',
    reply: '↳',
    reply_cont: '├',
};
const permCache = new Map();
const CACHE_TTL_MS = 600000;
//
function hasExternalEmojiPerm(guild, channel) {
    if (!guild) return false;
    const now = Date.now();
    const cached = permCache.get(guild.id);
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        return cached.hasPerm;
    }

    const botMember = guild.members.me;
    if (!botMember) return false;

    let hasPerm = false;
    if (channel && channel.permissionsFor) {
        hasPerm = Boolean(channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.UseExternalEmojis));
    } else {
        hasPerm = Boolean(botMember.permissions?.has(PermissionsBitField.Flags.UseExternalEmojis));
    }

    permCache.set(guild.id, { hasPerm, timestamp: now });
    return hasPerm;
}

function getEmoji(name, guild = null, channel = null) {
    const custom = EMOJIS[name];
    if (!custom) return FALLBACKS[name] || '';

    if (guild && !hasExternalEmojiPerm(guild, channel)) {
        return FALLBACKS[name] || '';
    }

    return custom;
}
//
module.exports = { EMOJIS, FALLBACKS, hasExternalEmojiPerm, getEmoji };
// contributors: @relentiousdragon
