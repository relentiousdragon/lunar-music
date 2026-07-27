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

    if (!data.totalPlays[trackId]) data.totalPlays[trackId] = { count: 0, title: trackTitle };
    data.totalPlays[trackId].count++;

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
module.exports = { updateSongStats, getTrackPlaysForUser };
// contributors: @relentiousdragon