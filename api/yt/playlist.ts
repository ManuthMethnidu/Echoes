import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../_lib/invidious.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    let { id, url, token } = req.query;
    let playlistInput = (typeof id === 'string' ? id : typeof url === 'string' ? url : '').trim();

    if (!playlistInput) {
        return res.status(400).json({ error: 'Missing playlist ?id= or ?url=' });
    }

    // Extract list ID from URL if provided
    if (playlistInput.includes('list=')) {
        playlistInput = playlistInput.split('list=')[1].split('&')[0];
    }

    const playlistId = playlistInput
        .replace(/^yt:playlist:/, '')
        .replace(/^yt_alb_/, '')
        .replace(/^yt:/, '')
        .trim();

    const apiKey = process.env.YOUTUBE_API_KEY;
    const userToken = typeof token === 'string' ? token : '';

    // If API key or User Token is available, fetch using official YouTube Data API v3
    if (apiKey || userToken) {
        try {
            const authQuery = apiKey ? `key=${apiKey}` : '';
            const headers: Record<string, string> = { Accept: 'application/json' };
            if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

            const ytRes = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(
                    playlistId
                )}&maxResults=50${authQuery ? `&${authQuery}` : ''}`,
                { headers }
            );

            if (ytRes.ok) {
                const data = await ytRes.json();
                const items = data.items || [];
                const tracks = items
                    .map((item: any, index: number) => {
                        const snippet = item.snippet || {};
                        const vid = snippet.resourceId?.videoId;
                        if (!vid || snippet.title === 'Private video') return null;

                        const rawTitle = snippet.title || 'Unknown Title';
                        const channelTitle = snippet.videoOwnerChannelTitle || snippet.channelTitle || 'Unknown Artist';
                        const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

                        let artistName = channelTitle.replace(/ - Topic$/i, '').trim();
                        let trackTitle = rawTitle;
                        if (rawTitle.includes(' - ')) {
                            const parts = rawTitle.split(' - ');
                            artistName = parts[0].trim();
                            trackTitle = parts.slice(1).join(' - ').trim();
                        }

                        return {
                            id: `yt:${vid}`,
                            videoId: vid,
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
                            _href: `/track/yt:${vid}`,
                        };
                    })
                    .filter(Boolean);

                return res.status(200).json({
                    id: `yt:playlist:${playlistId}`,
                    title: `YouTube Playlist (${playlistId})`,
                    cover: tracks[0]?.cover || 'images/echos_logo.svg',
                    trackCount: tracks.length,
                    tracks,
                    provider: 'youtube',
                });
            }
        } catch (apiErr) {
            console.warn('[YouTube API fetch failed, falling back to Invidious]:', apiErr);
        }
    }

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
