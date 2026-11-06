import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    let videoId = (typeof req.query.id === 'string' ? req.query.id : '').replace(/^yt:/, '').trim();

    // If no video ID provided, try searching for the track
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';

    if (!videoId && (title || artist)) {
        try {
            const query = `${artist} - ${title}`.trim();
            const searchRes = await fetch('https://music.youtube.com/youtubei/v1/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: 'WEB_REMIX',
                            clientVersion: '1.20231204.01.00',
                        },
                    },
                    query,
                    params: 'Eg-KAQwIABAAGAAgACgAMABqChAEEAMQBBAFEAo%3D', // Songs filter
                }),
            });

            if (searchRes.ok) {
                const sData = await searchRes.json();
                const sections =
                    sData.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ||
                    [];
                for (const section of sections) {
                    if (videoId) break;
                    // 1. Check musicCardShelfRenderer (standard for specific artist + title matches)
                    if (section.musicCardShelfRenderer) {
                        const card = section.musicCardShelfRenderer;
                        const cardId =
                            card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                            card.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId;
                        if (cardId) {
                            videoId = cardId;
                            break;
                        }
                    }
                    // 2. Check musicShelfRenderer (song lists / shelves)
                    if (section.musicShelfRenderer?.contents) {
                        for (const item of section.musicShelfRenderer.contents) {
                            const renderer = item.musicResponsiveListItemRenderer;
                            const songId =
                                renderer?.playlistItemData?.videoId ||
                                renderer?.navigationEndpoint?.watchEndpoint?.videoId;
                            if (songId) {
                                videoId = songId;
                                break;
                            }
                        }
                    }
                }
            }
        } catch (sErr) {
            console.warn('[YT Lyrics Search Error]', sErr);
        }
    }

    if (!videoId) {
        return res.status(400).json({ error: 'Missing video ?id= or title/artist' });
    }

    try {
        // 1. Fetch next endpoint from YouTube Music
        const nextRes = await fetch('https://music.youtube.com/youtubei/v1/next', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'WEB_REMIX',
                        clientVersion: '1.20231204.01.00',
                    },
                },
                videoId,
            }),
        });

        if (!nextRes.ok) {
            return res.status(404).json({ error: 'Failed to query YouTube Music next endpoint' });
        }

        const nextData = await nextRes.json();
        const tabs = nextData.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
        const lyricsTab = tabs?.find((t: any) => {
            const tabTitle = t.tabRenderer?.title?.toLowerCase() || '';
            const browseId = t.tabRenderer?.endpoint?.browseEndpoint?.browseId || '';
            return tabTitle === 'lyrics' || browseId.startsWith('FMLY') || browseId.startsWith('MPLY');
        });

        const browseId = lyricsTab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
        if (!browseId) {
            return res.status(404).json({ error: 'No lyrics available for this YouTube track' });
        }

        // 2. Query browse endpoint for lyrics content (try ANDROID_MUSIC client for timed lyrics)
        const browseRes = await fetch('https://music.youtube.com/youtubei/v1/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'ANDROID_MUSIC',
                        clientVersion: '6.42.52',
                        androidSdkVersion: 33,
                    },
                },
                browseId,
            }),
        });

        const browseData = await browseRes.json();
        const contentItem = browseData.contents?.sectionListRenderer?.contents?.[0];

        // A. Timed synced lyrics
        if (contentItem?.musicTimedLyricsRenderer) {
            const timedData = contentItem.musicTimedLyricsRenderer;
            const lines = timedData.timedLyricsData || [];
            const lrcLines: string[] = [];
            const plainLines: string[] = [];

            const pad = (n: number) => String(n).padStart(2, '0');

            for (const item of lines) {
                const text = item.lyricLine || '';
                const ms = parseInt(item.cueRange?.startTimeMilliseconds || '0', 10);
                const m = Math.floor(ms / 60000);
                const s = Math.floor((ms % 60000) / 1000);
                const cs = Math.floor((ms % 1000) / 10);
                lrcLines.push(`[${pad(m)}:${pad(s)}.${pad(cs)}] ${text}`);
                plainLines.push(text);
            }

            return res.status(200).json({
                syncedLyrics: lrcLines.join('\n'),
                plainLyrics: plainLines.join('\n'),
                lyricsProvider: 'YouTube Music (Synced)',
                source: timedData.source || 'YouTube Music',
            });
        }

        // B. Description shelf lyrics (Musixmatch / LyricFind official text)
        const shelf = contentItem?.musicDescriptionShelfRenderer;
        if (shelf?.description?.runs) {
            const plainLyrics = shelf.description.runs.map((r: any) => r.text).join('').trim();
            const footer = shelf.footer?.runs?.map((r: any) => r.text).join('') || 'YouTube Music';

            return res.status(200).json({
                syncedLyrics: null,
                plainLyrics,
                lyricsProvider: `YouTube Music (${footer})`,
                source: footer,
            });
        }

        return res.status(404).json({ error: 'Lyrics content not found in YouTube response' });
    } catch (err: any) {
        console.error('[YT Lyrics Error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
