import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { token } = req.query;
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Missing pairing token' });
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const rows = await sql`
            SELECT p.status, p.session_token, p.expires_at, u.id as user_id, u.email, u.name, u.avatar_url
            FROM device_pairings p
            LEFT JOIN users u ON u.id = p.user_id
            WHERE p.pairing_token = ${token}
            LIMIT 1
        `;

        if (rows.length === 0) {
            return res.status(200).json({ status: 'not_found' });
        }

        const record = rows[0];
        const isExpired = new Date(record.expires_at).getTime() < Date.now();

        if (isExpired) {
            return res.status(200).json({ status: 'expired' });
        }

        if (record.status === 'approved' && record.session_token) {
            // Pairing approved! Return the auth token and user
            // Also clean up or mark completed so it cannot be reused
            await sql`
                UPDATE device_pairings
                SET status = 'completed'
                WHERE pairing_token = ${token}
            `;

            return res.status(200).json({
                status: 'approved',
                token: record.session_token,
                user: {
                    id: record.user_id,
                    email: record.email,
                    name: record.name,
                    avatar_url: record.avatar_url,
                },
            });
        }

        return res.status(200).json({ status: record.status });
    } catch (err: any) {
        console.error('[Pair Status Error]', err);
        return res.status(500).json({ error: err.message || 'Error checking pairing status' });
    }
}
