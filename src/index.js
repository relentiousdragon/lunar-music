require('dotenv').config();
const fs = require('fs');
const { validateEnvironment } = require('./utils/config');
const logger = require('./utils/logger');
//
process.on('uncaughtException', (err) => {
    console.log(`[fatal] uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.log(`[fatal] unhandled rejection: ${reason}`);
});
//
const environment = validateEnvironment();
environment.warnings.forEach(message => logger.warn('config_warning', { message }));
if (!environment.valid) {
    environment.errors.forEach(message => logger.error('config_error', { message }));
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
const { registerInteractionCreate } = require('./events/interactionCreate');

// moonlink handlers
const { registerTrackStart } = require('./handlers/trackStart');
const { registerTrackEnd } = require('./handlers/trackEnd');
const { registerTrackError } = require('./handlers/trackError');
const { registerPlayerEvents } = require('./handlers/playerEvents');

registerReadyEvent();
registerMessageCreate();
registerVoiceStateUpdate();
registerInteractionCreate();
registerTrackStart();
registerTrackEnd();
registerTrackError();
registerPlayerEvents();
//
client.login(process.env.DISCORD_TOKEN);
// contributors: @relentiousdragon
