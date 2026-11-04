import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../../_lib/invidious.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { q, type } = req.query;
    if (!q || typeof q !== 'string') {
        return res.status(400).json({ error: 'Missing search query ?q=' });
    }

    try {
        const queryType = type || 'video';
        const { data, instance } = await fetchWithFailover(
            (base) => `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(String(queryType))}`
        );

        if (!Array.isArray(data)) {
            return res.status(200).json({ results: [] });
        }

        const results = data.map((item: any) => {
            // Handle channel results
            if (item.type === 'channel' || queryType === 'channel') {
                const authorId = item.authorId || item.id || '';
                const author = item.author || 'Unknown Artist';
                let picture = 'images/echos_logo.svg';
                if (Array.isArray(item.authorThumbnails) && item.authorThumbnails.length > 0) {
                    const sorted = [...item.authorThumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
                    picture = sorted[0].url;
                }
                const targetArtistId = `yt_art_${authorId || author.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                return {
                    id: targetArtistId,
                    name: author,
                    picture,
                    avatar: picture,
                    subCount: item.subCount || 0,
                    provider: 'youtube',
                    _href: `/artist/${targetArtistId}`,
                };
            }

            const videoId = item.videoId || item.id;
            const title = item.title || 'Unknown Title';
            const author = item.author || 'Unknown Artist';
            const duration = Number(item.lengthSeconds) || 0;
            // Always use i.ytimg.com direct Google CDN - guaranteed CORS and ultra fast 200 OK
            const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

            return {
                id: `yt:${videoId}`,
                videoId,
                title,
                duration,
                artist: {
                    id: `yt_art_${item.authorId || author.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                    name: author,
                    picture: thumb,
                    avatar: thumb,
                    provider: 'youtube',
                },
                artists: [
                    {
                        id: `yt_art_${item.authorId || author.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                        name: author,
                        picture: thumb,
                        provider: 'youtube',
                    },
                ],
                album: {
                    id: `yt_alb_${videoId}`,
                    title: title,
                    cover: thumb,
                    artist: { name: author },
                    provider: 'youtube',
                },
                cover: thumb,
                image: thumb,
                audioQuality: 'LOSSLESS',
                audioModes: ['STEREO'],
                allowStreaming: true,
                streamReady: true,
                isUnavailable: false,
                provider: 'youtube',
            };
        });

        return res.status(200).json({
            results,
            source: 'YouTube Music (ArchiveTune Engine)',
            instance,
        });
    } catch (err: any) {
        console.error('[YouTube Search Error]', err);
        return res.status(500).json({ error: err.message || 'YouTube search failed' });
    }
}
