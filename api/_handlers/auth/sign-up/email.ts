import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../../_lib/db.js';
import { hashPassword, createToken, setSessionCookie } from '../../../_lib/auth.js';
import { getClientIp, consumeRateLimit } from '../../../_lib/rateLimit.js';
import { sanitizeEmail, sanitizePassword, sanitizeString } from '../../../_lib/sanitize.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const clientIp = getClientIp(req);
        // Rate limit: 5 signups per hour per IP
        const signupLimit = await consumeRateLimit(`signup_ip:${clientIp}`, 5, 3600);
        if (!signupLimit.allowed) {
            const minutes = Math.max(1, Math.ceil(signupLimit.retryAfterSeconds / 60));
            res.setHeader('Retry-After', String(signupLimit.retryAfterSeconds));
            return res.status(429).json({
                error: {
                    message: `Too many sign-up attempts from this network. Please wait ${minutes} minute${minutes > 1 ? 's' : ''} before creating another account.`,
                    retryAfter: signupLimit.retryAfterSeconds,
                },
            });
        }

        const { email, password, name } = req.body || {};
        const normalizedEmail = sanitizeEmail(email);
        if (!normalizedEmail) {
            return res.status(400).json({ error: { message: 'A valid email address is required' } });
        }

        const passCheck = sanitizePassword(password);
        if (!passCheck.valid) {
            return res.status(400).json({ error: { message: passCheck.error } });
        }

        // Check if user already exists
        const existing = await sql`SELECT id FROM users WHERE email = ${normalizedEmail} LIMIT 1`;
        if (existing.length > 0) {
            return res.status(400).json({ error: { message: 'An account with this email already exists' } });
        }

        const userId = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const passwordHash = await hashPassword(password);
        const rawName = name ? sanitizeString(name, 60) : normalizedEmail.split('@')[0];
        const displayName = rawName || normalizedEmail.split('@')[0];
        const baseUsername = displayName.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user';
        const username = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

        // Insert user
        await sql`
            INSERT INTO users (id, email, password_hash, name)
            VALUES (${userId}, ${normalizedEmail}, ${passwordHash}, ${displayName})
        `;

        // Insert profile
        await sql`
            INSERT INTO profiles (id, user_id, name, username, display_name)
            VALUES (${userId}, ${userId}, ${displayName}, ${username}, ${displayName})
            ON CONFLICT (id) DO UPDATE SET
                username = EXCLUDED.username,
                display_name = EXCLUDED.display_name
        `;

        // Insert initial sync data
        await sql`
            INSERT INTO user_sync_data (user_id, library, history, user_playlists, user_folders)
            VALUES (
                ${userId},
                '{"tracks":{},"albums":{},"artists":{},"playlists":{},"mixes":{}}'::jsonb,
                '[]'::jsonb,
                '{}'::jsonb,
                '{}'::jsonb
            )
        `;

        const userObj = {
            id: userId,
            email: normalizedEmail,
            name: displayName,
        };

        const token = await createToken(userObj);
        setSessionCookie(res, token);

        return res.status(200).json({
            token,
            user: userObj,
        });
    } catch (err: any) {
        console.error('[Sign-Up Error]', err);
        return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
}
