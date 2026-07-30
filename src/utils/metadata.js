const { getEmoji } = require('./emojis');
const { getBotName } = require('./branding');
//
function getPlatformEmoji(track, guild = null, channel = null) {
    const source = (track?.sourceName || '').toLowerCase();
    const uri = (track?.uri || track?.url || '').toLowerCase();

    if (source.includes('youtubemusic') || source.includes('ytmsearch') || uri.includes('music.youtube') || uri.includes('music.youtu.be')) return getEmoji('youtube_music', guild, channel);
    if (source.includes('youtube') || source.includes('ytsearch') || uri.includes('youtube') || uri.includes('youtu.be')) return getEmoji('youtube', guild, channel);
    if (source.includes('spotify') || uri.includes('spotify')) return getEmoji('spotify', guild, channel);
    if (source.includes('soundcloud') || uri.includes('soundcloud')) return getEmoji('soundcloud', guild, channel);
    if (source.includes('deezer') || uri.includes('deezer')) return getEmoji('deezer', guild, channel);
    if (source.includes('applemusic') || source.includes('apple') || uri.includes('apple')) return getEmoji('apple_music', guild, channel);
    if (source.includes('tidal') || uri.includes('tidal')) return getEmoji('tidal', guild, channel);

    return getEmoji('headphones', guild, channel);
}

const metadataCache = new Map();
const METADATA_TTL = 24 * 60 * 60 * 1000;

async function fetchTrackMetadata(trackTitle, artistName, durationMs = 0) {
    if (!trackTitle || !artistName || artistName === 'Unknown Artist' || artistName === getBotName()) return null;
    const cacheKey = `${trackTitle.toLowerCase()}\u0000${artistName.toLowerCase()}\u0000${Math.round(Number(durationMs || 0) / 1000)}`;
    const cached = metadataCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    try {
        const primaryArtist = artistName.split(/[,&]|\s+ft\.|\s+feat\./i)[0].trim();
        const cleanTitle = trackTitle.split(/[([]/)[0].trim();
        const url = `https://api.deezer.com/search?q=track:"${encodeURIComponent(cleanTitle)}" artist:"${encodeURIComponent(primaryArtist)}"`;

        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();

        if (data.data && data.data.length > 0) {
            const requestedSeconds = Math.round(Number(durationMs || 0) / 1000);
            const track = requestedSeconds
                ? data.data.find(candidate => Math.abs(Number(candidate.duration || 0) - requestedSeconds) <= Math.max(6, requestedSeconds * 0.04))
                : data.data[0];
            if (!track) return null;
            let releaseDate = track.release_date;
            let bpm = Number(track.bpm) || null;

            if (!releaseDate || !bpm) {
                try {
                    const fullTrackRes = await fetch(`https://api.deezer.com/track/${track.id}`);
                    if (fullTrackRes.ok) {
                        const fullTrack = await fullTrackRes.json();
                        releaseDate = releaseDate || fullTrack.release_date;
                        bpm = bpm || Number(fullTrack.bpm) || null;
                    }
                } catch (e) {
                    //
                }
            }

            const value = {
                artistPfp: track.artist?.picture_medium || track.artist?.picture,
                releaseDate: releaseDate ? new Date(releaseDate) : null,
                bpm: bpm && bpm >= 40 && bpm <= 300 ? bpm : null
            };
            metadataCache.set(cacheKey, { value, expiresAt: Date.now() + METADATA_TTL });
            return value;
        }
        return null;
    } catch (e) {
        console.log(`[metadata] fetch failed: ${e.message}`);
        return null;
    }
}
//
module.exports = { getPlatformEmoji, fetchTrackMetadata };
// contributors: @relentiousdragon
