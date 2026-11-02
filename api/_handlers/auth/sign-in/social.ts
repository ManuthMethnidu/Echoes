import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { provider, callbackURL } = req.body || {};
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectUri = `${origin}/api/auth/callback`;

        if (provider === 'google' || provider === 'youtube') {
            const clientId = process.env.GOOGLE_CLIENT_ID;
            if (!clientId) {
                // If custom GOOGLE_CLIENT_ID is not configured, fall back to Neon Better Auth
                const neonAuthUrl = process.env.NEON_AUTH_BASE_URL || 'https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth';
                try {
                    const neonRes = await fetch(`${neonAuthUrl}/sign-in/social`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ provider: 'google', callbackURL: callbackURL || `${origin}/index.html` }),
                    });
                    const neonData = await neonRes.json();
                    if (neonData?.url) {
                        return res.status(200).json({ url: neonData.url, redirectUrl: neonData.url, redirect: true });
                    }
                } catch (e) {
                    console.warn('[Social Auth] Neon fallback error:', e);
                }
                return res.status(400).json({
                    error: { message: 'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID in Vercel environment variables.' }
                });
            }
            const state = Buffer.from(JSON.stringify({ provider, callbackURL: callbackURL || `${origin}/index.html` })).toString('base64');
            const scope = 'openid%20email%20profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly';
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&prompt=select_account&access_type=offline`;
            return res.status(200).json({ url: authUrl, redirectUrl: authUrl, redirect: true });
        }

        if (provider === 'github') {
            const clientId = process.env.GITHUB_CLIENT_ID;
            if (!clientId) {
                return res.status(400).json({
                    error: { message: 'GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID in Vercel environment variables.' }
                });
            }
            const state = Buffer.from(JSON.stringify({ provider: 'github', callbackURL: callbackURL || `${origin}/index.html` })).toString('base64');
            const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20user:email&state=${state}`;
            return res.status(200).json({ url: authUrl, redirectUrl: authUrl, redirect: true });
        }

        return res.status(400).json({ error: { message: `Unsupported provider: ${provider}` } });
    } catch (err: any) {
        console.error('[Social Auth Error]', err);
        return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
}
