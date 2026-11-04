import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { verifyPasswordResetToken, hashPassword } from '../../_lib/auth.js';
import { getClientIp, consumeRateLimit } from '../../_lib/rateLimit.js';
import { sanitizePassword } from '../../_lib/sanitize.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { token, newPassword } = req.body || {};
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ error: { message: 'Valid token is required' } });
        }

        const passCheck = sanitizePassword(newPassword);
        if (!passCheck.valid) {
            return res.status(400).json({ error: { message: passCheck.error } });
        }

        const sql = getDb();
        await ensureSchema(sql);

        const clientIp = getClientIp(req);
        const ipLimit = await consumeRateLimit(`reset_pwd_ip:${clientIp}`, 10, 900);
        if (!ipLimit.allowed) {
            res.setHeader('Retry-After', String(ipLimit.retryAfterSeconds));
            return res.status(429).json({
                error: {
                    message: 'Too many reset attempts. Please wait before trying again.',
                    retryAfter: ipLimit.retryAfterSeconds,
                },
            });
        }

        const tokenPayload = await verifyPasswordResetToken(token);
        if (!tokenPayload || !tokenPayload.id) {
            return res.status(400).json({
                error: { message: 'Invalid or expired password reset link. Please request a new one.' },
            });
        }

        const users = await sql`
            SELECT id, email, password_hash
            FROM users
            WHERE id = ${tokenPayload.id}
            LIMIT 1
        `;

        if (users.length === 0) {
            return res.status(400).json({
                error: { message: 'User account not found.' },
            });
        }

        const userRow = users[0];
        const currentFingerprint = (userRow.password_hash || '').slice(0, 16);
        if (tokenPayload.fingerprint !== currentFingerprint) {
            return res.status(400).json({
                error: { message: 'This password reset link has already been used. Please request a new one.' },
            });
        }

        const newPasswordHash = await hashPassword(newPassword);

        await sql`
            UPDATE users
            SET password_hash = ${newPasswordHash}, updated_at = NOW()
            WHERE id = ${userRow.id}
        `;

        return res.status(200).json({
            status: true,
            message: 'Password reset successfully. You can now sign in with your new password.',
        });
    } catch (err: any) {
        console.error('[Reset Password Error]', err);
        return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
}
