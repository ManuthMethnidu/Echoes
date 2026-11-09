import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { getAuthenticatedUser } from '../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const sql = getDb();
        await ensureSchema(sql);

        const profiles = await sql`
            SELECT p.*, u.email, u.name
            FROM profiles p
            JOIN users u ON u.id = p.user_id
            WHERE p.user_id = ${user.id}
            LIMIT 1
        `;

        const profile = profiles[0] || {};

        return res.status(200).json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar_url: profile.avatar_url,
            },
            profile: {
                username: profile.username,
                display_name: profile.display_name,
                avatar_url: profile.avatar_url,
                banner: profile.banner,
                banner_url: profile.banner,
                status: profile.status,
                about: profile.about,
                website: profile.website,
                privacy: profile.privacy || { playlists: 'public', lastfm: 'public' },
                lastfm_username: profile.lastfm_username,
                librefm_username: profile.librefm_username,
                favorite_albums: profile.favorite_albums || [],
                username_changed_at: profile.username_changed_at || null,
                display_name_changed_at: profile.display_name_changed_at || null,
            },
        });
    } catch (err: any) {
        console.error('[API /me error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
