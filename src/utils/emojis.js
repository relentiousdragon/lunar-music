const { PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
//
const LEGACY_EMOJIS = {
    vinyl: '<a:vinyl:1531203938265727076>',
    settings: '<:sound:1355490199660003430>',
    loading: '<a:utility_loading:1352304876708691968>',
    cd: '<a:icon_cd:1354424887120236584>',
    xmark: '<:utility_x:1352305400858415114>',
    tidal: '<:icon_tidal:1469626778401116264>',
    loop: '<:loop:1352305910554296320>',
    star: '<:utility_star:1352310953701806110>',
    spotify: '<:icon_spotify:1354447467252289857>',
    soundcloud: '<:icon_soundcloud:1354447410478190732>',
    right: '<:utility_purple_right:1353398788047372389>',
    reply_cont: '<:utility_purple_right:1353398788047372389>',
    reply: '<:utility_purple_right:1353398788047372389>',
    headphones: '<:sound:1355490199660003430>',
    youtube: '<:youtube:0>',
    youtube_music: '<:youtube_music:0>',
    deezer: '<:icon_deezer:1354447426479587430>',
    checkmark: '<:utility_check_mark:1352305451693379727>',
    apple_music: '<:icon_apple_music:1469626775704440842>',
    monochrome: '<:sound:1355490199660003430>',
};
const emojiStatePath = path.join(__dirname, 'emojis.json');
let emojiState = {};
try {
    const parsed = JSON.parse(fs.readFileSync(emojiStatePath, 'utf8'));
    emojiState = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
} catch {
    emojiState = {};
}
const APPLICATION_EMOJIS = new Set(Object.keys(emojiState));
const EMOJIS = Object.fromEntries(Object.entries(emojiState).map(([name, emoji]) => [
    name,
    `<${emoji.animated ? 'a' : ''}:${emoji.name || name}:${emoji.id}>`
]));
for (const [name, value] of Object.entries(LEGACY_EMOJIS)) {
    if (!EMOJIS[name]) EMOJIS[name] = value;
}
const FALLBACKS = {
    youtube: '🎧',
    youtube_music: '🎧',
    spotify: '🎧',
    soundcloud: '🎧',
    deezer: '🎧',
    apple_music: '🎧',
    tidal: '🎧',
    monochrome: '🎧',
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

    if (guild && !APPLICATION_EMOJIS.has(name) && !hasExternalEmojiPerm(guild, channel)) {
        return FALLBACKS[name] || '';
    }

    return custom;
}
//
module.exports = { EMOJIS, FALLBACKS, hasExternalEmojiPerm, getEmoji };
// contributors: @relentiousdragon
