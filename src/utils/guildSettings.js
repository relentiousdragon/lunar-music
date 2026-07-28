const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(process.cwd(), '.moonlink', 'guild-settings.json');
const VALID_SOURCES = new Set(['youtube', 'youtubemusic', 'soundcloud', 'spotify', 'deezer', 'applemusic', 'tidal']);
let settings = {};

try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    settings = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
} catch { }
//
function getDefaultSearchSource(guildId) {
    return settings[guildId]?.defaultSearchSource || null;
}

function setDefaultSearchSource(guildId, source) {
    if (!VALID_SOURCES.has(source)) throw new Error('Invalid search source');
    settings[guildId] = { ...settings[guildId], defaultSearchSource: source };
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
    return source;
}

function clearDefaultSearchSource(guildId) {
    if (!settings[guildId]) return;
    delete settings[guildId].defaultSearchSource;
    if (Object.keys(settings[guildId]).length === 0) delete settings[guildId];
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}
//
module.exports = { VALID_SOURCES, getDefaultSearchSource, setDefaultSearchSource, clearDefaultSearchSource };
// contributors: @relentiousdragon