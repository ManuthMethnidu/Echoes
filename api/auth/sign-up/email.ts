import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { hashPassword, createToken, setSessionCookie } from '../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const { email, password, name } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ error: { message: 'Email and password are required' } });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        if (password.length < 6) {
            return res.status(400).json({ error: { message: 'Password must be at least 6 characters' } });
        }

        // Check if user already exists
        const existing = await sql`SELECT id FROM users WHERE email = ${normalizedEmail} LIMIT 1`;
        if (existing.length > 0) {
            return res.status(400).json({ error: { message: 'An account with this email already exists' } });
        }

        const userId = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const passwordHash = await hashPassword(password);
        const displayName = name ? String(name).trim() : normalizedEmail.split('@')[0];
        const baseUsername = displayName.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user';
        const username = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

        // Insert user
        await sql`
            INSERT INTO users (id, email, password_hash, name)
            VALUES (${userId}, ${normalizedEmail}, ${passwordHash}, ${displayName})
        `;

        // Insert profile
        await sql`
            INSERT INTO profiles (user_id, username, display_name)
            VALUES (${userId}, ${username}, ${displayName})
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
