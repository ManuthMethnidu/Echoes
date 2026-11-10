import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../../_lib/invidious.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    let { id, name } = req.query;
    const rawInput = (typeof id === 'string' ? id : typeof name === 'string' ? name : '').trim();

    if (!rawInput) {
        return res.status(400).json({ error: 'Missing artist ?id= or ?name=' });
    }

    const clean = rawInput
        .replace(/^yt_art_/, '')
        .replace(/^yt:/, '')
        .trim();

    try {
        let channelId = '';
        let artistName = clean;
        let artistPicture = '/images/echos_logo.svg';
        let bio = '';
        let channelVideos: any[] = [];
        let channelPlaylists: any[] = [];

        // 1. If clean looks like a channel ID (starts with UC)
        if (/^UC[a-zA-Z0-9_-]{20,}$/.test(clean)) {
            channelId = clean;
            try {
                const { data } = await fetchWithFailover((base) => `${base}/api/v1/channels/${channelId}`);
                if (data && data.author) {
                    artistName = data.author;
                    bio = data.description || '';
                    if (Array.isArray(data.authorThumbnails) && data.authorThumbnails.length > 0) {
                        const sorted = [...data.authorThumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
                        artistPicture = sorted[0].url;
                    }
                }
            } catch (err) {
                console.warn('[YouTube Artist] Channel by ID fetch warning:', err);
            }

            // Fallback: If Invidious failed or author is still the raw channel ID (common with YouTube Topic channels),
            // fetch the YouTube channel page directly to extract og:title, og:image, and og:description
            if (!artistName || /^UC[a-zA-Z0-9_-]{20,}$/.test(artistName)) {
                try {
                    const ytRes = await fetch(`https://www.youtube.com/channel/${channelId}`, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept-Language': 'en-US,en;q=0.9',
                        },
                    });
                    if (ytRes.ok) {
                        const html = await ytRes.text();
                        const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1];
                        const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
                        const rawTitle = ogTitle || titleTag || '';
                        const parsedName = rawTitle.replace(/\s*-\s*Topic$/i, '').replace(/\s*-\s*YouTube$/i, '').trim();
                        if (parsedName) {
                            artistName = parsedName;
                        }
                        const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1];
                        if (ogImage) {
                            artistPicture = ogImage;
                        }
                        const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1];
                        if (ogDesc && !bio) {
                            bio = ogDesc;
                        }
                    }
                } catch (ytErr) {
                    console.warn('[YouTube Artist] Direct channel scraper fallback warning:', ytErr);
                }
            }
        }

        artistName = (artistName || clean).replace(/\s*-\s*Topic$/i, '').trim();

        // 2. If no channel ID or channel name is still raw, search by channel name
        if (!channelId) {
            try {
                const { data } = await fetchWithFailover(
                    (base) => `${base}/api/v1/search?q=${encodeURIComponent(clean)}&type=channel`
                );
                if (Array.isArray(data) && data.length > 0) {
                    const ch = data[0];
                    channelId = ch.authorId || '';
                    artistName = ch.author || artistName;
                    bio = ch.description || '';
                    if (Array.isArray(ch.authorThumbnails) && ch.authorThumbnails.length > 0) {
                        const sorted = [...ch.authorThumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
                        artistPicture = sorted[0].url;
                    }
                }
            } catch (err) {
                console.warn('[YouTube Artist] Channel search warning:', err);
            }
        }

        // 3. Fetch top tracks / videos for this artist
        try {
            if (channelId) {
                try {
                    const { data: vData } = await fetchWithFailover(
                        (base) => `${base}/api/v1/channels/${channelId}/videos`
                    );
                    if (vData && Array.isArray(vData.videos) && vData.videos.length > 0) {
                        channelVideos = vData.videos;
                    }
                } catch {
                    // Fall back to video search if channel videos failed
                }
            }

            if (channelVideos.length === 0 && artistName && !/^UC[a-zA-Z0-9_-]{20,}$/.test(artistName)) {
                const { data: sData } = await fetchWithFailover(
                    (base) => `${base}/api/v1/search?q=${encodeURIComponent(artistName)}&type=video`
                );
                if (Array.isArray(sData)) {
                    channelVideos = sData;
                }
            }
        } catch (err) {
            console.warn('[YouTube Artist] Track fetch warning:', err);
        }

        // 4. Fetch playlists / albums for this artist
        try {
            if (artistName && !/^UC[a-zA-Z0-9_-]{20,}$/.test(artistName)) {
                const { data: pData } = await fetchWithFailover(
                    (base) => `${base}/api/v1/search?q=${encodeURIComponent(artistName + ' album')}&type=playlist`
                );
                if (Array.isArray(pData)) {
                    channelPlaylists = pData;
                }
            }
        } catch (err) {
            console.warn('[YouTube Artist] Playlist fetch warning:', err);
        }

        // Format tracks
        const targetArtistId = `yt_art_${channelId || clean.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const tracks = channelVideos.slice(0, 30).map((item: any) => {
            const vid = item.videoId || item.id;
            const title = item.title || 'Unknown Title';
            const duration = Number(item.lengthSeconds) || 0;
            const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

            return {
                id: `yt:${vid}`,
                videoId: vid,
                title,
                duration,
                artist: {
                    id: targetArtistId,
                    name: artistName,
                    picture: artistPicture,
                    provider: 'youtube',
                },
                artists: [
                    {
                        id: targetArtistId,
                        name: artistName,
                        picture: artistPicture,
                        provider: 'youtube',
                    },
                ],
                album: {
                    id: `yt_alb_${vid}`,
                    title,
                    cover: thumb,
                    artist: { name: artistName, id: targetArtistId },
                    provider: 'youtube',
                },
                cover: thumb,
                image: thumb,
                audioQuality: 'HIGH',
                audioModes: ['STEREO'],
                allowStreaming: true,
                streamReady: true,
                isUnavailable: false,
                provider: 'youtube',
            };
        });

        // Set artist picture from first track if channel thumbnail was missing or placeholder
        if ((!artistPicture || artistPicture.includes('echos_logo.svg')) && tracks.length > 0 && tracks[0].cover) {
            artistPicture = tracks[0].cover;
        }

        // Format albums
        const albums = channelPlaylists.slice(0, 15).map((p: any) => {
            const pId = p.playlistId || p.id;
            const thumb = p.playlistThumbnail || (tracks.length > 0 ? tracks[0].cover : '/images/echos_logo.svg');
            return {
                id: pId,
                title: p.title || 'Album',
                cover: thumb,
                artist: { name: artistName, id: targetArtistId },
                artists: [{ name: artistName, id: targetArtistId }],
                numberOfTracks: p.videoCount || 0,
                type: 'ALBUM',
                provider: 'youtube',
                _href: `/album/${pId}`,
            };
        });

        return res.status(200).json({
            id: targetArtistId,
            name: artistName,
            picture: artistPicture,
            biography: bio,
            popularity: 88,
            artistRoles: [{ category: 'Artist' }],
            tracks,
            albums,
            eps: [],
            mixes: {},
            provider: 'youtube',
        });
    } catch (err: any) {
        console.error('[YouTube Artist Error]', err);
        return res.status(500).json({ error: err.message || 'YouTube artist fetch failed' });
    }
}
