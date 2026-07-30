const sharp = require('sharp');
//
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
    const n = String(hex || '#8c6cff').replace('#', '');
    const v = Number.parseInt(n.slice(0, 6), 16);
    return { r: v >> 16, g: v >> 8 & 255, b: v & 255 };
}

function colorDistance(c1, c2) {
    const dr = c1.r - c2.r, dg = c1.g - c2.g, db = c1.b - c2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

function saturation(rgb) {
    const max = Math.max(rgb.r, rgb.g, rgb.b);
    const min = Math.min(rgb.r, rgb.g, rgb.b);
    return max === 0 ? 0 : (max - min) / max;
}

function brightness(rgb) {
    return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
}

function regionAverage(data, width, startX, startY, endX, endY) {
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = startY; y < endY && y < data.length / (width * 3); y++) {
        for (let x = startX; x < endX && x < width; x++) {
            const i = (y * width + x) * 3;
            r += data[i]; g += data[i + 1]; b += data[i + 2];
            count++;
        }
    }
    if (count === 0) return { r: 128, g: 128, b: 128 };
    return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

function kMeansCluster(pixels, k, iterations = 12) {
    let centroids = pixels.slice(0, k).map(p => ({ ...p }));
    for (let iter = 0; iter < iterations; iter++) {
        const clusters = Array.from({ length: k }, () => []);
        for (const px of pixels) {
            let minDist = Infinity, minIdx = 0;
            for (let c = 0; c < centroids.length; c++) {
                const d = colorDistance(px, centroids[c]);
                if (d < minDist) { minDist = d; minIdx = c; }
            }
            clusters[minIdx].push(px);
        }
        for (let c = 0; c < k; c++) {
            if (clusters[c].length === 0) continue;
            centroids[c] = {
                r: Math.round(clusters[c].reduce((s, p) => s + p.r, 0) / clusters[c].length),
                g: Math.round(clusters[c].reduce((s, p) => s + p.g, 0) / clusters[c].length),
                b: Math.round(clusters[c].reduce((s, p) => s + p.b, 0) / clusters[c].length)
            };
        }
    }
    return centroids;
}

async function getDominantColor(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch image');
    const buffer = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(buffer)
        .resize(64, 64, { fit: 'inside' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0;
    const pixels = info.width * info.height;
    for (let i = 0; i < data.length; i += 3) {
        r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
    return rgbToHex(Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels));
}

async function getArtworkPalette(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch image');
    const buffer = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(buffer)
        .resize(96, 96, { fit: 'inside' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const w = info.width, h = info.height;
    const totalPixels = w * h;

    const samples = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 3;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const lum = (r * 299 + g * 587 + b * 114) / 1000;
            const sat = saturation({ r, g, b });
            if (sat > 0.2 && lum > 30 && lum < 220) {
                samples.push({ r, g, b });
            }
        }
    }
    if (samples.length < 50) samples.push({ r: 140, g: 108, b: 255 }, { r: 100, g: 180, b: 255 }, { r: 255, g: 120, b: 180 });

    const clustered = kMeansCluster(samples.slice(0, 800), 5, 10);

    clustered.sort((a, b) => {
        const sa = saturation(a), sb = saturation(b);
        const ba = brightness(a), bb = brightness(b);
        const scoreA = sa * 2 - Math.abs(ba - 128) / 64;
        const scoreB = sb * 2 - Math.abs(bb - 128) / 64;
        return scoreB - scoreA;
    });

    const boostSat = (rgb, amount = 1.4) => {
        const max = Math.max(rgb.r, rgb.g, rgb.b);
        const min = Math.min(rgb.r, rgb.g, rgb.b);
        if (max === 0) return rgb;
        const newMax = Math.min(255, max * amount);
        const scale = newMax / max;
        return {
            r: Math.min(255, Math.round(min + (rgb.r - min) * scale)),
            g: Math.min(255, Math.round(min + (rgb.g - min) * scale)),
            b: Math.min(255, Math.round(min + (rgb.b - min) * scale))
        };
    };

    const palette = clustered.slice(0, 3).map(c => boostSat(c, 1.35));

    const MIN_DIST = 50;
    const final = [palette[0]];
    for (let i = 1; i < palette.length && final.length < 3; i++) {
        if (final.every(existing => colorDistance(existing, palette[i]) >= MIN_DIST)) {
            final.push(palette[i]);
        }
    }
    while (final.length < 3) {
        const base = final[final.length - 1] || final[0];
        const variation = {
            r: Math.max(0, Math.min(255, base.r + (final.length === 1 ? 50 : -50))),
            g: Math.max(0, Math.min(255, base.g + (final.length === 1 ? 40 : -40))),
            b: Math.max(0, Math.min(255, base.b + (final.length === 1 ? 30 : -30)))
        };
        final.push(variation);
    }

    return {
        accent: rgbToHex(final[0].r, final[0].g, final[0].b),
        secondary: rgbToHex(final[1].r, final[1].g, final[1].b),
        tertiary: rgbToHex(final[2].r, final[2].g, final[2].b)
    };
}

function getPlatformColor(track) {
    const source = (track?.sourceName || '').toLowerCase();
    const uri = (track?.uri || track?.url || '').toLowerCase();
    if (source.includes('youtube') || source.includes('ytsearch') || uri.includes('youtube') || uri.includes('youtu.be')) return '#FF0000';
    if (uri.includes('spotify')) return '#1DB954';
    if (uri.includes('soundcloud')) return '#FF5500';
    if (uri.includes('deezer')) return '#c830c6ff';
    if (uri.includes('apple')) return '#ffc5c7ff';
    if (uri.includes('tidal')) return '#abababff';
    return '#6A5ACD';
}

function getPlatformPalette(track) {
    const color = getPlatformColor(track);
    const rgb = hexToRgb(color);
    return {
        accent: color,
        secondary: rgbToHex(Math.max(0, rgb.r - 30), Math.max(0, rgb.g - 20), Math.min(255, rgb.b + 40)),
        tertiary: rgbToHex(Math.min(255, rgb.r + 30), Math.max(0, rgb.g - 10), Math.max(0, rgb.b - 30))
    };
}
//
module.exports = { getDominantColor, getArtworkPalette, rgbToHex, hexToRgb, getPlatformColor, getPlatformPalette };
// contributors: @relentiousdragon
