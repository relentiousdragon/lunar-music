const fs = require('fs');
const path = require('path');

const EMOJI_STATE_PATH = path.join(__dirname, 'emojis.json');
const EMOJI_ASSET_DIR = path.join(__dirname, '..', '..', 'assets', 'emojis');
const DISCORD_API = 'https://discord.com/api/v10';
const MAX_BYTES = 256 * 1024;
const VALID_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
//
function readState() {
    try {
        if (!fs.existsSync(EMOJI_STATE_PATH)) {
            fs.writeFileSync(EMOJI_STATE_PATH, '{}\n', 'utf8');
            return {};
        }
        const raw = fs.readFileSync(EMOJI_STATE_PATH, 'utf8').trim();
        if (!raw) {
            fs.writeFileSync(EMOJI_STATE_PATH, '{}\n', 'utf8');
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.error(`[emoji-sync] could not read ${EMOJI_STATE_PATH}: ${error.message}`);
        return {};
    }
}

function writeState(state) {
    const temporaryPath = `${EMOJI_STATE_PATH}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, EMOJI_STATE_PATH);
}

function emojiName(fileName) {
    return path.basename(fileName, path.extname(fileName))
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
}

function mimeType(extension) {
    return {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif'
    }[extension] || 'application/octet-stream';
}

async function discordRequest(token, url, options = {}, attempt = 0) {
    const response = await fetch(`${DISCORD_API}${url}`, {
        ...options,
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (response.status === 429 || response.status >= 500) {
        if (attempt < 3) {
            const retryAfter = Number(response.headers.get('retry-after')) || Math.min(2 ** attempt, 8);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return discordRequest(token, url, options, attempt + 1);
        }
    }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
    if (!response.ok) {
        throw new Error(`Discord API ${response.status}: ${body?.message || 'request failed'}`);
    }
    return body;
}

async function syncApplicationEmojis({ token = process.env.DISCORD_TOKEN, applicationId = process.env.DISCORD_APPLICATION_ID } = {}) {
    const state = readState();
    // Treat any stored entry as an explicit operator decision: never upload,
    // reconcile, rename, or replace emojis once the registry has content.
    if (Object.keys(state).length > 0) {
        console.log(`[emoji-sync] registry contains ${Object.keys(state).length} entries; skipping upload`);
        return state;
    }
    if (!token) {
        console.warn('[emoji-sync] DISCORD_TOKEN missing; using emoji state without syncing');
        return state;
    }
    if (!fs.existsSync(EMOJI_ASSET_DIR)) {
        console.warn(`[emoji-sync] asset directory missing: ${EMOJI_ASSET_DIR}`);
        return state;
    }

    try {
        if (!applicationId) {
            const user = await discordRequest(token, '/users/@me');
            applicationId = user.id;
        }
        const listed = await discordRequest(token, `/applications/${applicationId}/emojis`);
        const remote = new Map((listed?.items || []).map(emoji => [emoji.name, emoji]));
        const files = fs.readdirSync(EMOJI_ASSET_DIR)
            .filter(file => VALID_EXTENSIONS.has(path.extname(file).toLowerCase()))
            .sort();

        for (const file of files) {
            const name = emojiName(file);
            if (!name) continue;
            const filePath = path.join(EMOJI_ASSET_DIR, file);
            const stat = fs.statSync(filePath);
            if (stat.size > MAX_BYTES) {
                console.warn(`[emoji-sync] skipping ${file}: ${stat.size} bytes exceeds Discord's 256 KiB limit`);
                continue;
            }

            const saved = state[name];
            const existing = (saved?.id && (listed?.items || []).find(emoji => emoji.id === saved.id)) || remote.get(name);
            if (existing) {
                state[name] = { id: existing.id, name: existing.name, animated: Boolean(existing.animated) };
                continue;
            }

            const extension = path.extname(file).toLowerCase();
            const image = `data:${mimeType(extension)};base64,${fs.readFileSync(filePath).toString('base64')}`;
            const created = await discordRequest(token, `/applications/${applicationId}/emojis`, {
                method: 'POST',
                body: JSON.stringify({ name, image })
            });
            state[name] = { id: created.id, name: created.name, animated: Boolean(created.animated) };
            console.log(`[emoji-sync] uploaded ${name} (${created.id})`);
        }

        writeState(state);
        console.log(`[emoji-sync] synchronized ${Object.keys(state).length} application emojis`);
    } catch (error) {
        console.error(`[emoji-sync] sync failed; bot startup will continue: ${error.message}`);
        try { writeState(state); } catch (writeError) { console.error(`[emoji-sync] state write failed: ${writeError.message}`); }
    }
    return state;
}
//
module.exports = { EMOJI_STATE_PATH, EMOJI_ASSET_DIR, readState, syncApplicationEmojis };
// contributors: @relentiousdragon