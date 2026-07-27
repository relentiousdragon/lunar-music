const { getEmoji } = require('./emojis');
const { getBotName } = require('./branding');
//
function getPlatformEmoji(track, guild = null, channel = null) {
    const source = (track?.sourceName || '').toLowerCase();
    const uri = (track?.uri || track?.url || '').toLowerCase();

    if (source.includes('spotify') || uri.includes('spotify')) return getEmoji('spotify', guild, channel);
    if (source.includes('soundcloud') || uri.includes('soundcloud')) return getEmoji('soundcloud', guild, channel);
    if (source.includes('deezer') || uri.includes('deezer')) return getEmoji('deezer', guild, channel);
    if (source.includes('applemusic') || source.includes('apple') || uri.includes('apple')) return getEmoji('apple_music', guild, channel);
    if (source.includes('tidal') || uri.includes('tidal')) return getEmoji('tidal', guild, channel);

    return getEmoji('headphones', guild, channel);
}

async function fetchTrackMetadata(trackTitle, artistName) {
    if (!trackTitle || !artistName || artistName === 'Unknown Artist' || artistName === getBotName()) return null;
    try {
        const primaryArtist = artistName.split(/[,&]|\s+ft\.|\s+feat\./i)[0].trim();
        const cleanTitle = trackTitle.split(/[([]/)[0].trim();
        const url = `https://api.deezer.com/search?q=track:"${encodeURIComponent(cleanTitle)}" artist:"${encodeURIComponent(primaryArtist)}"`;

        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();

        if (data.data && data.data.length > 0) {
            let track = data.data[0];
            let releaseDate = track.release_date;

            if (!releaseDate) {
                try {
                    const fullTrackRes = await fetch(`https://api.deezer.com/track/${track.id}`);
                    if (fullTrackRes.ok) {
                        const fullTrack = await fullTrackRes.json();
                        releaseDate = fullTrack.release_date;
                    }
                } catch (e) {
                    //
                }
            }

            return {
                artistPfp: track.artist?.picture_medium || track.artist?.picture,
                releaseDate: releaseDate ? new Date(releaseDate) : null
            };
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