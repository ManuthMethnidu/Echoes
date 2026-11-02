import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthenticatedUser } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(200).json({ session: null, user: null });
        }

        return res.status(200).json({
            session: {
                id: 'sess_' + user.id,
                userId: user.id,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                },
            },
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
            },
        });
    } catch (err: any) {
        return res.status(200).json({ session: null, user: null });
    }
}
