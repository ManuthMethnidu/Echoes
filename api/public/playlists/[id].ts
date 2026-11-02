import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../../_lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing playlist ID' });
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        // Find playlist in user_sync_data where user_playlists contains this id
        const rows = await sql`
            SELECT s.user_playlists->${id} as playlist, p.username, p.display_name
            FROM user_sync_data s
            JOIN profiles p ON p.user_id = s.user_id
            WHERE s.user_playlists ? ${id}
            LIMIT 1
        `;

        if (rows.length === 0 || !rows[0].playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        const pl = rows[0].playlist;
        return res.status(200).json({
            ...pl,
            owner: {
                username: rows[0].username,
                displayName: rows[0].display_name,
            },
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Error fetching playlist' });
    }
}
