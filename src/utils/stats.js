const fs = require('fs');
//
function updateSongStats(guildId, track, userId) {
    const filePath = `./stats/${guildId}.json`;
    let data = { totalPlays: {}, userPlays: {} };

    if (fs.existsSync(filePath)) {
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.log(`[stats] failed to read ${guildId}: ${e.message}`);
        }
    }

    const trackId = track.identifier || track.title || 'unknown';
    const trackTitle = track.title || 'Unknown Track';

    if (!data.totalPlays[trackId]) {
        data.totalPlays[trackId] = {
            count: 0,
            title: trackTitle,
            author: track.author || null,
            uri: track.uri || track.url || null
        };
    }
    const song = data.totalPlays[trackId];
    if (!song.author && track.author) song.author = track.author;
    if (!song.uri && (track.uri || track.url)) song.uri = track.uri || track.url;
    song.count++;

    if (!data.userPlays[userId]) data.userPlays[userId] = {};
    if (!data.userPlays[userId][trackId]) data.userPlays[userId][trackId] = 0;
    data.userPlays[userId][trackId]++;

    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.log(`[stats] failed to write ${guildId}: ${e.message}`);
    }

    return data;
}

function getGlobalTopTracks(limit = 25) {
    if (!fs.existsSync('./stats')) return [];
    const aggregate = new Map();
    for (const file of fs.readdirSync('./stats').filter(name => name.endsWith('.json'))) {
        try {
            const data = JSON.parse(fs.readFileSync(`./stats/${file}`, 'utf8'));
            for (const [id, song] of Object.entries(data.totalPlays || {})) {
                const current = aggregate.get(id) || { count: 0, title: song.title, author: song.author, uri: song.uri };
                current.count += Number(song.count) || 0;
                if (!current.uri && song.uri) current.uri = song.uri;
                if (!current.author && song.author) current.author = song.author;
                aggregate.set(id, current);
            }
        } catch { }
    }
    return [...aggregate.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

function getTrackPlaysForUser(guildId, trackId, userId) {
    const filePath = `./stats/${guildId}.json`;
    if (!fs.existsSync(filePath)) return 0;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data.userPlays?.[userId]?.[trackId] || 0;
    } catch (e) {
        return 0;
    }
}
//
module.exports = { updateSongStats, getTrackPlaysForUser, getGlobalTopTracks };
// contributors: @relentiousdragon
