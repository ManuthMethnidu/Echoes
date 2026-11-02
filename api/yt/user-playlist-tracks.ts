import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';

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

    let googleAccessToken = '';

    // If token starts with Google access token prefix 'ya29.', use it directly
    if (token && token.startsWith('ya29.')) {
        googleAccessToken = token;
    } else {
        // Try resolving Google OAuth access token from Neon Auth
        try {
            const sql = getDb();
            let authUser = null;

            if (token) {
                authUser = await verifyToken(token);
            }

            if (authUser) {
                const accounts = await sql`
                    SELECT "accessToken" FROM neon_auth.account 
                    WHERE "providerId" = 'google' 
                      AND (
                          "accountId" = ${authUser.email}
                          OR "userId"::text = ${authUser.id}
                          OR "userId"::text IN (SELECT id::text FROM neon_auth.user WHERE email = ${authUser.email})
                      )
                    ORDER BY "updatedAt" DESC 
                    LIMIT 1;
                `;
                if (accounts.length > 0 && accounts[0].accessToken) {
                    googleAccessToken = accounts[0].accessToken;
                }
            }
        } catch (dbErr) {
            console.warn('[Neon Auth Lookup Error in YouTube Tracks]', dbErr);
        }
    }

    if (!googleAccessToken && token) {
        googleAccessToken = token;
    }

    if (!googleAccessToken) {
        return res.status(401).json({
            error: 'Missing Google YouTube access token. Please sign in with Google or connect your YouTube account.',
        });
    }

    try {
        const ytRes = await fetch(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(
                playlistId
            )}&maxResults=50`,
            {
                headers: {
                    Authorization: `Bearer ${googleAccessToken}`,
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
                    streamProvider: 'yt',
                };
            })
            .filter(Boolean);

        return res.status(200).json({
            ok: true,
            playlistId,
            tracks,
        });
    } catch (err: any) {
        console.error('[YouTube User Playlist Tracks Error]', err);
        return res.status(500).json({ error: err.message || 'Failed to fetch playlist tracks' });
    }
}
