import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { username } = req.query;
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Missing username' });
    }

    const cleanUsername = username.replace(/^@/, '');

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const rows = await sql`
            SELECT p.*, u.email, u.name
            FROM profiles p
            JOIN users u ON u.id = p.user_id
            WHERE p.username = ${cleanUsername}
            LIMIT 1
        `;

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const profile = rows[0];
        return res.status(200).json({
            id: profile.user_id,
            username: profile.username,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url,
            banner: profile.banner,
            status: profile.status,
            about: profile.about,
            website: profile.website,
            privacy: profile.privacy,
            favorite_albums: profile.favorite_albums || [],
            created: profile.created_at,
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Error fetching user' });
    }
}
