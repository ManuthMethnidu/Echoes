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
        const { token, otp, email, newPassword } = req.body || {};
        const code = otp || (typeof token === 'string' && /^\d{6}$/.test(token.trim()) ? token.trim() : null);

        if (!token && !code) {
            return res.status(400).json({ error: { message: 'Valid token or OTP code is required' } });
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

        // Branch A: Reset via 6-digit Email OTP from Neon Better Auth
        if (code && email) {
            try {
                const neonRes = await fetch(
                    'https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth/email-otp/reset-password',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: String(email).trim().toLowerCase(),
                            otp: code,
                            password: newPassword,
                        }),
                    }
                );

                if (!neonRes.ok) {
                    const neonErr = await neonRes.json().catch(() => ({}));
                    const rawMsg = (neonErr.message || '').toLowerCase();
                    const isGoogleErr =
                        rawMsg.includes('credential') ||
                        rawMsg.includes('provider') ||
                        rawMsg.includes('password') ||
                        rawMsg.includes('not found');

                    return res.status(400).json({
                        error: {
                            message: isGoogleErr
                                ? 'This account was created with Google Sign-In and does not use a password. Please sign in directly with Google.'
                                : neonErr.message || 'Invalid or expired verification code',
                        },
                    });
                }

                const newPasswordHash = await hashPassword(newPassword);
                await sql`
                    UPDATE users
                    SET password_hash = ${newPasswordHash}, updated_at = NOW()
                    WHERE email = ${String(email).trim().toLowerCase()}
                `;

                return res.status(200).json({
                    status: true,
                    message: 'Password reset successfully. You can now sign in with your new password.',
                });
            } catch (err: any) {
                console.error('[Neon Auth OTP Reset Error]', err);
                return res.status(500).json({ error: { message: err.message || 'OTP reset failed' } });
            }
        }

        // Branch B: Reset via signed HMAC URL token

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

        // Google OAuth Check
        let isGoogleAccount = !userRow.password_hash;
        if (!isGoogleAccount && userRow.email) {
            try {
                const googleAccounts = await sql`
                    SELECT a.id 
                    FROM neon_auth.account a
                    JOIN neon_auth.user u ON u.id = a."userId"
                    WHERE LOWER(u.email) = ${userRow.email.toLowerCase()} AND a."providerId" = 'google'
                    LIMIT 1
                `;
                if (googleAccounts.length > 0) {
                    isGoogleAccount = true;
                }
            } catch (e) {
                console.warn('[Check Google Account Error in Reset]', e);
            }
        }

        if (isGoogleAccount) {
            return res.status(400).json({
                error: {
                    message:
                        'This account was created with Google Sign-In and cannot have a password set. Please sign in directly with Google.',
                },
            });
        }

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
