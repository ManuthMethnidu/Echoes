import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { playlistId } = req.query;
    const authHeader = req.headers.authorization;
    let token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token && authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    if (!playlistId || typeof playlistId !== 'string') {
        return res.status(400).json({ error: 'Missing playlistId parameter (?playlistId=)' });
    }

    if (!token) {
        return res.status(401).json({
            error: 'Missing Google YouTube access token. Please connect your YouTube account.',
        });
    }

    try {
        const ytRes = await fetch(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(
                playlistId
            )}&maxResults=50`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                },
            }
        );

        if (!ytRes.ok) {
            const errBody = await ytRes.text();
            let parsedErr = errBody;
            try {
                parsedErr = JSON.parse(errBody)?.error?.message || errBody;
            } catch {}
            return res.status(ytRes.status).json({
                error: `YouTube API returned HTTP ${ytRes.status}: ${parsedErr}`,
            });
        }

        const data = await ytRes.json();
        const items = data.items || [];

        const tracks = items
            .map((item: any, index: number) => {
                const snippet = item.snippet || {};
                const resourceId = snippet.resourceId || {};
                const videoId = resourceId.videoId;

                if (!videoId || snippet.title === 'Private video' || snippet.title === 'Deleted video') {
                    return null;
                }

                const rawTitle = snippet.title || 'Unknown Title';
                const channelTitle = snippet.videoOwnerChannelTitle || snippet.channelTitle || 'Unknown Artist';
                const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

                // Extract artist if title is "Artist - Track"
                let artistName = channelTitle.replace(/ - Topic$/i, '').trim();
                let trackTitle = rawTitle;
                if (rawTitle.includes(' - ')) {
                    const parts = rawTitle.split(' - ');
                    artistName = parts[0].trim();
                    trackTitle = parts.slice(1).join(' - ').trim();
                }

                return {
                    id: `yt:${videoId}`,
                    videoId,
                    title: trackTitle,
                    duration: 0,
                    trackNumber: index + 1,
                    volumeNumber: 1,
                    artist: {
                        id: `yt_art_${artistName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                        name: artistName,
                        picture: thumb,
                    },
                    artists: [
                        {
                            id: `yt_art_${artistName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                            name: artistName,
                            picture: thumb,
                        },
                    ],
                    album: {
                        id: `yt:playlist:${playlistId}`,
                        title: snippet.title || trackTitle,
                        cover: thumb,
                        artist: { name: artistName },
                    },
                    cover: thumb,
                    image: thumb,
                    audioQuality: 'LOSSLESS',
                    audioModes: ['STEREO'],
                    allowStreaming: true,
                    streamReady: true,
                    isUnavailable: false,
                    provider: 'youtube',
                    _href: `/track/yt:${videoId}`,
                };
            })
            .filter(Boolean);

        return res.status(200).json({
            ok: true,
            playlistId,
            trackCount: tracks.length,
            tracks,
        });
    } catch (err: any) {
        console.error('[YouTube User Playlist Tracks Error]', err);
        return res.status(500).json({ error: err.message || 'Failed to fetch playlist tracks' });
    }
}
