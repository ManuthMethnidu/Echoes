import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { verifyPassword, createToken, setSessionCookie } from '../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ error: { message: 'Email and password are required' } });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const users = await sql`
            SELECT id, email, password_hash, name, avatar_url
            FROM users
            WHERE email = ${normalizedEmail}
            LIMIT 1
        `;

        if (users.length === 0 || !users[0].password_hash) {
            return res.status(401).json({ error: { message: 'Invalid email or password' } });
        }

        const userRow = users[0];
        const isValid = await verifyPassword(password, userRow.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: { message: 'Invalid email or password' } });
        }

        const userObj = {
            id: userRow.id,
            email: userRow.email,
            name: userRow.name || userRow.email.split('@')[0],
            avatar_url: userRow.avatar_url,
        };

        const token = await createToken(userObj);
        setSessionCookie(res, token);

        return res.status(200).json({
            token,
            user: userObj,
        });
    } catch (err: any) {
        console.error('[Sign-In Error]', err);
        return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
}
