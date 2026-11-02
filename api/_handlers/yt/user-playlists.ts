import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../_lib/db.js';
import { verifyToken } from '../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const authHeader = req.headers.authorization;
    let token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token && authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
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
            console.warn('[Neon Auth Lookup Error in YouTube Playlists]', dbErr);
        }
    }

    // Fallback: if token was passed directly (not starting with ya29), test it anyway
    if (!googleAccessToken && token) {
        googleAccessToken = token;
    }

    if (!googleAccessToken) {
        return res.status(401).json({
            error: 'Missing Google YouTube access token. Please sign in with Google via Neon Auth or connect your YouTube account.',
        });
    }

    try {
        const ytRes = await fetch(
            'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50',
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

        const playlists = items.map((item: any) => {
            const snippet = item.snippet || {};
            const contentDetails = item.contentDetails || {};
            const thumbnails = snippet.thumbnails || {};
            const thumbUrl =
                thumbnails.high?.url ||
                thumbnails.medium?.url ||
                thumbnails.default?.url ||
                'images/echos_logo.svg';

            return {
                id: item.id,
                title: snippet.title || 'Untitled Playlist',
                description: snippet.description || '',
                channelTitle: snippet.channelTitle || '',
                thumbnail: thumbUrl,
                itemCount: Number(contentDetails.itemCount) || 0,
                publishedAt: snippet.publishedAt || '',
            };
        });

        // Add 'Liked Music / Videos' entry (YouTube special playlist ID 'LL')
        const allPlaylists = [
            {
                id: 'LL',
                title: 'Liked Music & Videos',
                description: 'Your liked tracks from YouTube Music',
                channelTitle: 'You',
                thumbnail: 'images/echos_logo.svg',
                itemCount: 0,
                isLikedList: true,
            },
            ...playlists,
        ];

        return res.status(200).json({
            ok: true,
            total: allPlaylists.length,
            playlists: allPlaylists,
        });
    } catch (err: any) {
        console.error('[YouTube User Playlists Error]', err);
        return res.status(500).json({ error: err.message || 'Failed to fetch YouTube playlists' });
    }
}
