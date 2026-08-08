function write(level, event, data = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        event,
        ...data
    };
    const format = (process.env.LOG_FORMAT || '').trim().toLowerCase();
    if (format === 'json') {
        console.log(JSON.stringify(entry));
        return;
    }
    const details = Object.entries(data)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
        .join(' ');
    console.log(`[${entry.timestamp}] ${level.toUpperCase()} ${event}${details ? ` | ${details}` : ''}`);
}
//
module.exports = {
    debug: (event, data) => write('debug', event, data),
    info: (event, data) => write('info', event, data),
    warn: (event, data) => write('warn', event, data),
    error: (event, data) => write('error', event, data)
};
// contributors: @relentiousdragon