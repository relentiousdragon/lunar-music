const manager = require('../manager');
const { searchFailures } = require('../state');
//
async function searchWithRetry(player, query, requester, source = 'spotify', attempt = 1) {
    const maxAttempts = 2;
    try {
        if (/(youtube\.com|youtu\.be|ytsearch:)/i.test(query)) {
            console.log(`[search] blocked youtube query from ${requester.id || requester}`);
            return { loadType: 'empty', tracks: [], isEmpty: true };
        }

        console.log(`[search] attempt ${attempt} | query: "${query}" | source: ${source || 'auto'}`);

        const searchOptions = {
            query,
            requester: requester.id || (typeof requester === 'string' ? requester : 'unknown')
        };
        if (source) searchOptions.source = source;

        if (!source && !/^https?:\/\//i.test(query) && !/^(sc|dz|am|td)search:/i.test(query)) {
            searchOptions.source = 'spotify';
        }

        const result = await Promise.race([
            manager.search(searchOptions),
            new Promise((_, reject) => setTimeout(() => reject(new Error('search timeout after 20s')), 20000))
        ]);

        if (!result || result.loadType === 'error' || result.loadType === 'empty' || !result.tracks || result.tracks.length === 0) {
            console.log(`[search] attempt ${attempt} failed | query: "${query}"`);

            const now = Date.now();
            searchFailures.push(now);

            while (searchFailures.length > 0 && now - searchFailures[0] > 120000) {
                searchFailures.shift();
            }

            if (searchFailures.length >= 2) {
                console.log(`[search] ${searchFailures.length} failures in 2 minutes, reconnecting nodes`);
                manager.nodes.forEach(node => {
                    console.log(`[manager] reconnecting node: ${node.identifier}`);
                    node.reconnect();
                });
                searchFailures.length = 0;
            }

            if (query.startsWith('http') || attempt >= 3) {
                return result || { loadType: 'empty', tracks: [] };
            }

            await new Promise(r => setTimeout(r, 1000));

            if (attempt === 1 && !source && !/^(sc|dz|am|td)search:/i.test(query)) {
                return await searchWithRetry(player, query, requester, 'soundcloud', attempt + 1);
            }

            if (attempt === 2) {
                console.log(`[search] final fallback for: ${query}`);
                const queryWithoutPrefix = query.replace(/^(sc|dz|am|td)search:/i, '');
                const finalResult = await manager.search({
                    query: queryWithoutPrefix,
                    requester: requester.id || (typeof requester === 'string' ? requester : 'unknown')
                });

                if (finalResult.tracks) {
                    finalResult.tracks = finalResult.tracks.filter(t => !/(youtube\.com|youtu\.be)/i.test(t.uri || ''));
                    if (finalResult.tracks.length === 0) finalResult.loadType = 'empty';
                }
                return finalResult;
            }
        }

        if (result.tracks && result.tracks.length > 0) {
            const count = result.tracks.length;
            result.tracks = result.tracks.filter(t => !/(youtube\.com|youtu\.be)/i.test(t.uri || ''));
            if (result.tracks.length === 0) {
                console.log(`[search] all ${count} results were youtube, filtered`);
                result.loadType = 'empty';
            }
        }

        return result;
    } catch (err) {
        console.log(`[search] attempt ${attempt} exception: ${err.message}`);

        if (attempt < maxAttempts && !query.startsWith('http') && !/^(sc|dz|am|td)search:/i.test(query)) {
            return await searchWithRetry(player, `scsearch:${query}`, requester, null, attempt + 1);
        }

        return { loadType: 'empty', tracks: [] };
    }
}
//
module.exports = { searchWithRetry };
// contributors: @relentiousdragon