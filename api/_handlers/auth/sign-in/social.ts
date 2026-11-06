import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../../_lib/db.js';

const ALLOWED_ORIGINS = [
    'https://echoes.mteck.tech',
    'https://echos.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
];

function getSafeOrigin(req: VercelRequest): string {
    const defaultOrigin = 'https://echoes.mteck.tech';
    const rawOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    if (rawOrigin && ALLOWED_ORIGINS.includes(rawOrigin)) {
        return rawOrigin;
    }
    const forwardedHost = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
    const host = forwardedHost.split(',')[0].trim();
    if (host) {
        const candidate = `https://${host}`;
        if (ALLOWED_ORIGINS.includes(candidate)) {
            return candidate;
        }
    }
    return defaultOrigin;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const payload = req.method === 'POST' ? req.body || {} : req.query || {};
        const { provider } = payload;
        const origin = getSafeOrigin(req);

        const neonAuthUrl = process.env.NEON_AUTH_BASE_URL || 'https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth';

        if (!provider || provider === 'google' || provider === 'youtube') {
            try {
                const sql = getDb();
                await ensureSchema(sql);

                const flowId = crypto.randomUUID();
                await sql`
                    INSERT INTO oauth_flows (flow_id, provider)
                    VALUES (${flowId}, 'google')
                    ON CONFLICT (flow_id) DO NOTHING
                `.catch((dbErr) => console.warn('[OAuth Flow DB Insert]', dbErr));

                const targetCallback = `${origin}/api/auth/callback/neon?flow=${flowId}`;

                const neonRes = await fetch(`${neonAuthUrl}/sign-in/social`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: 'google',
                        callbackURL: targetCallback,
                    }),
                });
                const neonData = await neonRes.json();
                if (neonData?.url) {
                    if (req.method === 'GET') {
                        return res.redirect(302, neonData.url);
                    }
                    return res.status(200).json({ url: neonData.url, redirectUrl: neonData.url, redirect: true });
                }
                console.error('[Neon Auth Social Sign-In Response]', neonData);
                return res.status(neonRes.status || 400).json({
                    error: { message: neonData?.message || neonData?.error || 'Failed to initiate Google sign-in with Neon Auth' }
                });
            } catch (neonErr: any) {
                console.error('[Neon Auth Error]', neonErr);
                return res.status(502).json({
                    error: { message: 'Failed to contact Neon Auth service: ' + (neonErr.message || String(neonErr)) }
                });
            }
        }

        return res.status(400).json({ error: { message: `Unsupported provider: ${provider}` } });
    } catch (err: any) {
        console.error('[Social Auth Error]', err);
        return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
}