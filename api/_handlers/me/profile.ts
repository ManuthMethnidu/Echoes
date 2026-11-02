import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { getAuthenticatedUser } from '../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'PATCH' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const sql = getDb();
        await ensureSchema(sql);

        const body = req.body || {};
        const {
            display_name,
            avatar_url,
            banner,
            status,
            about,
            website,
            privacy,
            lastfm_username,
            librefm_username,
            favorite_albums,
        } = body;

        await sql`
            UPDATE profiles
            SET
                display_name = COALESCE(${display_name ?? null}, display_name),
                avatar_url = COALESCE(${avatar_url ?? null}, avatar_url),
                banner = COALESCE(${banner ?? null}, banner),
                status = COALESCE(${status ?? null}, status),
                about = COALESCE(${about ?? null}, about),
                website = COALESCE(${website ?? null}, website),
                privacy = CASE WHEN ${privacy ? JSON.stringify(privacy) : null}::text IS NOT NULL THEN ${privacy ? JSON.stringify(privacy) : null}::jsonb ELSE privacy END,
                lastfm_username = COALESCE(${lastfm_username ?? null}, lastfm_username),
                librefm_username = COALESCE(${librefm_username ?? null}, librefm_username),
                favorite_albums = CASE WHEN ${favorite_albums ? JSON.stringify(favorite_albums) : null}::text IS NOT NULL THEN ${favorite_albums ? JSON.stringify(favorite_albums) : null}::jsonb ELSE favorite_albums END,
                updated_at = NOW()
            WHERE user_id = ${user.id}
        `;

        return res.status(200).json({ ok: true });
    } catch (err: any) {
        console.error('[API /me/profile error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
