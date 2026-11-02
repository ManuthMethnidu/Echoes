import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../_lib/invidious.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    let { id } = req.query;
    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing playlist ?id=' });
    }

    const playlistId = id.replace(/^yt:playlist:/, '').replace(/^yt_alb_/, '').replace(/^yt:/, '').trim();

    try {
        const { data } = await fetchWithFailover(
            (base) => `${base}/api/v1/playlists/${playlistId}`
        );

        const videos = data.videos || [];
        const tracks = videos.map((v: any, index: number) => {
            const vid = v.videoId;
            const title = v.title || 'Unknown Track';
            const author = v.author || data.author || 'Unknown Artist';
            const duration = Number(v.lengthSeconds) || 0;
            const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

            return {
                id: `yt:${vid}`,
                videoId: vid,
                title,
                duration,
                trackNumber: index + 1,
                volumeNumber: 1,
                artist: {
                    id: `yt_art_${author.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                    name: author,
                    picture: thumb,
                },
                artists: [
                    {
                        id: `yt_art_${author.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                        name: author,
                    },
                ],
                album: {
                    id: `yt:playlist:${playlistId}`,
                    title: data.title || title,
                    cover: data.playlistThumbnail || thumb,
                    artist: { name: author },
                },
                cover: thumb,
                audioQuality: 'LOSSLESS',
                audioModes: ['STEREO'],
                allowStreaming: true,
                streamReady: true,
                isUnavailable: false,
                provider: 'youtube',
            };
        });

        return res.status(200).json({
            id: `yt:playlist:${playlistId}`,
            title: data.title,
            description: data.description,
            author: data.author,
            thumbnail: data.playlistThumbnail,
            cover: data.playlistThumbnail,
            trackCount: data.videoCount || tracks.length,
            tracks,
            provider: 'youtube',
        });
    } catch (err: any) {
        console.error('[YouTube Playlist Error]', err);
        return res.status(500).json({ error: err.message || 'Failed to fetch playlist tracks' });
    }
}
