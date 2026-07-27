async function setVoiceChannelStatus(vc, status) {
    const url = `https://discord.com/api/v10/channels/${vc.id}/voice-status`;
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
    } catch (error) {
        console.log(`[voice] failed to update channel status: ${error.message}`);
    }
}
//
module.exports = { setVoiceChannelStatus };
// contributors: @relentiousdragon