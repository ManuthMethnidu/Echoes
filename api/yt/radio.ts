import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../_lib/invidious.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    let { id } = req.query;
    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing track ?id=' });
    }

    const videoId = id.replace(/^yt:/, '').trim();

    try {
        const { data } = await fetchWithFailover(
            (base) => `${base}/api/v1/videos/${videoId}`
        );

        const recs = data.recommendedVideos || [];
        const results = recs.map((item: any) => {
            const vid = item.videoId;
            const title = item.title || 'Unknown Title';
            const author = item.author || 'Unknown Artist';
            const duration = Number(item.lengthSeconds) || 0;
            const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

            return {
                id: `yt:${vid}`,
                videoId: vid,
                title,
                duration,
                artist: {
                    id: `yt_art_${author.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                    name: author,
                    picture: thumb,
                    avatar: thumb,
                    provider: 'youtube',
                },
                artists: [{ id: `yt_art_${author.toLowerCase().replace(/[^a-z0-9]/g, '')}`, name: author, picture: thumb, provider: 'youtube' }],
                album: { id: `yt_alb_${vid}`, title, cover: thumb, artist: { name: author }, provider: 'youtube' },
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

        return res.status(200).json({ results });
    } catch (err: any) {
        console.error('[YouTube Radio Error]', err);
        return res.status(500).json({ error: err.message || 'Failed to fetch radio tracks' });
    }
}
