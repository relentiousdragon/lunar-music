async function fetchLyrics(track) {
    try {
        let title = (track.title || '').toString();
        const artist = (track.author || '').toString();
        const trackLen = track.duration || 0;
        const duration = Math.floor(trackLen / 1000);

        title = title
            .replace(/\(Official Video\)/gi, '')
            .replace(/\(Official Audio\)/gi, '')
            .replace(/\(Lyric Video\)/gi, '')
            .replace(/\(Lyrics\)/gi, '')
            .replace(/\[.*\]/g, '')
            .trim();

        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&duration=${duration}`;
        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        if (!data.syncedLyrics) return null;

        const lines = data.syncedLyrics.split('\n').map(line => {
            const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
            if (!match) return null;
            const mins = parseInt(match[1]);
            const secs = parseFloat(match[2]);
            const time = (mins * 60 + secs) * 1000;
            return { time, text: match[3].trim() };
        }).filter(l => l && l.text);

        return lines.length ? lines : null;
    } catch (err) {
        console.log(`[lyrics] fetch failed: ${err.message}`);
        return null;
    }
}
//
module.exports = { fetchLyrics };
// contributors: @relentiousdragon