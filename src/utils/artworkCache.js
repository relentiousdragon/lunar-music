const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const CACHE_DIR = path.join(process.cwd(), '.moonlink', 'artwork-cache');
const MAX_CACHE_SIZE = 200 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ENABLED = process.env.ACTIVITY_ENABLED === 'true';
//
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function hashUrl(url) {
    return crypto.createHash('md5').update(url).digest('hex');
}

function guessExtension(contentType, url) {
    if (contentType?.includes('png')) return '.png';
    if (contentType?.includes('webp')) return '.webp';
    if (contentType?.includes('gif')) return '.gif';
    if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return '.jpg';
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (['.png', '.webp', '.gif', '.jpg', '.jpeg'].includes(ext)) return ext;
    return '.jpg';
}

function getCachedPath(url) {
    if (!ENABLED) return null;
    try {
        if (!fs.existsSync(CACHE_DIR)) return null;
        const h = hashUrl(url);
        const existing = fs.readdirSync(CACHE_DIR).find(f => f.startsWith(h));
        return existing ? path.join(CACHE_DIR, existing) : null;
    } catch { return null; }
}

function getCacheUrl(url) {
    const cached = getCachedPath(url);
    if (!cached) return null;
    return `/artwork/cache/${path.basename(cached)}`;
}

async function cacheArtwork(url) {
    if (!ENABLED || !url) return null;
    try {
        const existing = getCachedPath(url);
        if (existing) return existing;

        ensureCacheDir();
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) return null;
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 8 * 1024 * 1024) return null;

        const ext = guessExtension(contentType, url);
        const filename = `${hashUrl(url)}${ext}`;
        const filePath = path.join(CACHE_DIR, filename);
        fs.writeFileSync(filePath, buffer);

        pruneOldCache();
        return filePath;
    } catch (error) {
        logger.warn('artwork_cache_fail', { url: url.slice(0, 120), error: error.message });
        return null;
    }
}

function pruneOldCache() {
    try {
        if (!fs.existsSync(CACHE_DIR)) return;
        const files = fs.readdirSync(CACHE_DIR)
            .map(f => {
                const fp = path.join(CACHE_DIR, f);
                try { return { name: f, path: fp, time: fs.statSync(fp).mtimeMs }; } catch { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time);

        let totalSize = files.reduce((sum, f) => {
            try { return sum + fs.statSync(f.path).size; } catch { return sum; }
        }, 0);

        for (const file of files) {
            const age = Date.now() - file.time;
            let size;
            try { size = fs.statSync(file.path).size; } catch { continue; }
            if (age > MAX_AGE_MS || totalSize > MAX_CACHE_SIZE) {
                try { fs.unlinkSync(file.path); } catch { }
                totalSize -= size;
            } else break;
        }
    } catch { }
}
//
module.exports = { cacheArtwork, getCacheUrl, getCachedPath };
// contributors: @relentiousdragon