const sharp = require('sharp');
//
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
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
    }

    r = Math.round(r / pixels);
    g = Math.round(g / pixels);
    b = Math.round(b / pixels);

    return rgbToHex(r, g, b);
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function getPlatformColor(track) {
    const uri = track.uri || track.url || '';
    if (uri.includes('spotify')) return '#1DB954';
    if (uri.includes('soundcloud')) return '#FF5500';
    if (uri.includes('deezer')) return '#c830c6ff';
    if (uri.includes('apple')) return '#ffc5c7ff';
    if (uri.includes('tidal')) return '#abababff';
    return '#6A5ACD';
}
//
module.exports = { getDominantColor, rgbToHex, getPlatformColor };
// contributors: @relentiousdragon