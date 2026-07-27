const client = require('../client');
//
function getBotName() {
    return process.env.BOT_NAME || 'Lunar';
}

function getBotFooter(extraText = '') {
    const name = getBotName();
    const text = extraText ? `${name}  •  ${extraText}` : name;
    const iconURL = client.user?.displayAvatarURL() || null;
    return iconURL ? { text, iconURL } : { text };
}
//
module.exports = { getBotName, getBotFooter };
// contributors: @relentiousdragon
