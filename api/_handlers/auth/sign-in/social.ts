import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { provider, callbackURL } = req.body || {};
        const forwardedHost = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
        const host = forwardedHost.split(',')[0].trim();
        const origin = (req.headers.origin as string) || (host ? `https://${host}` : 'https://echoes.mteck.tech');

        const neonAuthUrl = process.env.NEON_AUTH_BASE_URL || 'https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth';

        if (provider === 'google' || provider === 'youtube') {
            // Use Neon Shared OAuth for Google Sign-In
            try {
                const neonRes = await fetch(`${neonAuthUrl}/sign-in/social`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: 'google',
                        callbackURL: callbackURL || `${origin}/index.html`,
                    }),
                });
                const neonData = await neonRes.json();
                if (neonData?.url) {
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
