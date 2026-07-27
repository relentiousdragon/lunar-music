require('dotenv').config();
const fs = require('fs');
//
process.on('uncaughtException', (err) => {
    console.log(`[fatal] uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.log(`[fatal] unhandled rejection: ${reason}`);
});
//
if (!process.env.DISCORD_TOKEN) {
    console.log('[boot] missing DISCORD_TOKEN in .env - copy .env.example to .env and fill it in');
    process.exit(1);
}

if (!fs.existsSync('./stats')) {
    fs.mkdirSync('./stats');
}
//
const client = require('./client');
require('./manager');

// events
const { registerReadyEvent } = require('./events/ready');
const { registerMessageCreate } = require('./events/messageCreate');
const { registerVoiceStateUpdate } = require('./events/voiceStateUpdate');

// moonlink handlers
const { registerTrackStart } = require('./handlers/trackStart');
const { registerTrackEnd } = require('./handlers/trackEnd');
const { registerTrackError } = require('./handlers/trackError');
const { registerPlayerEvents } = require('./handlers/playerEvents');

registerReadyEvent();
registerMessageCreate();
registerVoiceStateUpdate();
registerTrackStart();
registerTrackEnd();
registerTrackError();
registerPlayerEvents();
//
client.login(process.env.DISCORD_TOKEN);
// contributors: @relentiousdragon