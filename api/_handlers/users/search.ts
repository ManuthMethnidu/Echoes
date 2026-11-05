import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
        return res.status(200).json({ users: [] });
    }

    const cleanQuery = q.startsWith('@') ? q.slice(1).trim() : q;
    if (!cleanQuery) {
        return res.status(200).json({ users: [] });
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 50);

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const pattern = `%${cleanQuery}%`;

        const rows = await sql`
            SELECT 
                p.user_id,
                p.username,
                p.display_name,
                p.avatar_url,
                p.about,
                p.status
            FROM profiles p
            WHERE (p.username ILIKE ${pattern} OR p.display_name ILIKE ${pattern})
            ORDER BY 
                CASE 
                    WHEN p.username ILIKE ${cleanQuery} THEN 1
                    WHEN p.username ILIKE ${cleanQuery + '%'} THEN 2
                    WHEN p.display_name ILIKE ${cleanQuery + '%'} THEN 3
                    ELSE 4
                END,
                p.updated_at DESC
            LIMIT ${limit}
        `;

        const users = rows.map((r: any) => ({
            id: r.user_id,
            username: r.username,
            display_name: r.display_name || r.username,
            avatar_url: r.avatar_url || '',
            about: r.about || '',
            status: r.status || '',
        }));

        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return res.status(200).json({ users });
    } catch (err: any) {
        console.error('[User Search Error]', err);
        return res.status(500).json({ error: err.message || 'Error searching users' });
    }
}
