import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../_lib/db.js';
import { getAuthenticatedUser, createToken } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Please log in on your phone before approving this TV device' });
        }

        const { code } = req.body || {};
        if (!code || typeof code !== 'string') {
            return res.status(400).json({ error: 'Missing pairing code' });
        }

        const normalizedCode = code.toUpperCase().replace(/[\s-]/g, '').trim();

        const sql = getDb();
        await ensureSchema(sql);

        const rows = await sql`
            SELECT id, status, expires_at
            FROM device_pairings
            WHERE code = ${normalizedCode}
            LIMIT 1
        `;

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Invalid pairing code. Please generate a new code on your TV.' });
        }

        const record = rows[0];
        if (new Date(record.expires_at).getTime() < Date.now()) {
            return res.status(400).json({ error: 'This pairing code has expired. Please refresh the QR code on your TV.' });
        }

        if (record.status !== 'pending') {
            return res.status(400).json({ error: `This code has already been ${record.status}.` });
        }

        // Generate a new long-lived session token for the TV device
        const tvSessionToken = await createToken({
            id: user.id,
            email: user.email,
            name: user.name,
        });

        await sql`
            UPDATE device_pairings
            SET
                status = 'approved',
                user_id = ${user.id},
                session_token = ${tvSessionToken}
            WHERE id = ${record.id}
        `;

        return res.status(200).json({
            success: true,
            message: 'Device authorized successfully! Your TV is now signed in.',
        });
    } catch (err: any) {
        console.error('[Pair Approve Error]', err);
        return res.status(500).json({ error: err.message || 'Error approving pairing' });
    }
}
