import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { url, id: queryId } = req.query;
    const input = (typeof url === 'string' ? url : typeof queryId === 'string' ? queryId : '').trim();

    if (!input) {
        return res.status(400).json({ error: 'Missing Spotify playlist or album URL/ID (?url= or ?id=)' });
    }

    try {
        let type: 'playlist' | 'album' = 'playlist';
        let id = input;

        // Follow shortened spotify.link redirects if necessary
        if (id.includes('spotify.link/')) {
            try {
                const headRes = await fetch(id, {
                    redirect: 'follow',
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    },
                });
                if (headRes.url) {
                    id = headRes.url;
                }
            } catch {}
        }

        if (id.includes('spotify:playlist:')) {
            type = 'playlist';
            id = id.split('spotify:playlist:')[1];
        } else if (id.includes('spotify:album:')) {
            type = 'album';
            id = id.split('spotify:album:')[1];
        } else if (id.includes('open.spotify.com/playlist/')) {
            type = 'playlist';
            id = id.split('open.spotify.com/playlist/')[1].split('?')[0].split('/')[0];
        } else if (id.includes('open.spotify.com/album/')) {
            type = 'album';
            id = id.split('open.spotify.com/album/')[1].split('?')[0].split('/')[0];
        }

        id = id.replace(/[^a-zA-Z0-9]/g, '');

        if (!id) {
            return res.status(400).json({ error: 'Invalid Spotify URL or playlist ID.' });
        }

        const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
        const embedRes = await fetch(embedUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        if (!embedRes.ok) {
            return res.status(embedRes.status).json({
                error: `Spotify returned HTTP ${embedRes.status}. Make sure the playlist or album is public.`,
            });
        }

        const html = await embedRes.text();
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
        if (!match) {
            return res.status(502).json({ error: 'Could not extract playlist metadata from Spotify.' });
        }

        const json = JSON.parse(match[1]);
        const entity = json.props?.pageProps?.state?.data?.entity;
        if (!entity) {
            return res.status(404).json({ error: 'Spotify playlist or album entity not found.' });
        }

        const rawTracks = entity.trackList || [];
        const tracks = rawTracks.map((t: any, index: number) => ({
            trackNumber: index + 1,
            title: t.title || 'Unknown Track',
            artist: t.subtitle || entity.subtitle || 'Unknown Artist',
            duration: t.duration ? Math.round(Number(t.duration) / 1000) : 0,
            spotifyUri: t.uri || '',
            isExplicit: Boolean(t.isExplicit),
        }));

        const imageList = entity.visualIdentity?.image || entity.coverArt?.sources || entity.images || [];
        let cover = '';
        if (Array.isArray(imageList) && imageList.length > 0) {
            const sortedImages = [...imageList].sort(
                (a: any, b: any) => (b.maxWidth || b.width || b.maxHeight || 0) - (a.maxWidth || a.width || a.maxHeight || 0)
            );
            cover = sortedImages[0]?.url || '';
        }

        return res.status(200).json({
            ok: true,
            success: true,
            source: 'spotify',
            type,
            id,
            name: entity.name || (type === 'album' ? 'Untitled Album' : 'Untitled Playlist'),
            description: entity.description || entity.subtitle || '',
            author: entity.subtitle || entity.owner?.name || '',
            cover,
            trackCount: tracks.length,
            tracks,
        });
    } catch (err: any) {
        console.error('[Spotify Import Error]', err);
        return res.status(500).json({ error: err.message || 'Failed to import Spotify playlist' });
    }
}
