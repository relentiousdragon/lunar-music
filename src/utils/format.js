function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getFormattedDuration(track) {
    return formatTime(track.duration || 0);
}

function getTrackUrl(track) {
    return track?.uri || track?.url || '#';
}

function getRequesterId(track) {
    const r = track.userData?.requester || track.requestedBy || track.requester;
    if (!r) return 'unknown';
    if (typeof r === 'string') return r;
    return r.id || 'unknown';
}
//
module.exports = { formatTime, getFormattedDuration, getTrackUrl, getRequesterId };
// contributors: @relentiousdragon
