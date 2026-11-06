import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { getClientIp, consumeRateLimit } from '../../_lib/rateLimit.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { code } = req.query;
    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Missing code' });
    }

    const clientIp = getClientIp(req);
    const limit = await consumeRateLimit(`pair_verify:${clientIp}`, 20, 60);
    if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many verification attempts. Please wait.' });
    }

    const normalizedCode = code.toUpperCase().replace(/[\s-]/g, '').trim();

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const rows = await sql`
            SELECT id, code, status, device_info, expires_at
            FROM device_pairings
            WHERE code = ${normalizedCode}
            LIMIT 1
        `;

        if (rows.length === 0) {
            return res.status(404).json({ valid: false, error: 'Pairing code not found' });
        }

        const record = rows[0];
        const isExpired = new Date(record.expires_at).getTime() < Date.now();

        return res.status(200).json({
            valid: !isExpired && record.status === 'pending',
            status: isExpired ? 'expired' : record.status,
            deviceInfo: record.device_info,
            expiresAt: record.expires_at,
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Verification failed' });
    }
}
