import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { createToken, setSessionCookie } from '../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { code, state, error } = req.query;
    const forwardedHost = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
    const host = forwardedHost.split(',')[0].trim();
    const origin = (req.headers.origin as string) || (host ? `https://${host}` : 'https://echoes.mteck.tech');

    let callbackURL = `${origin}/index.html`;
    let provider = 'google';
    let redirectUri = `${origin}/api/auth/callback`;

    if (state && typeof state === 'string') {
        try {
            const parsed = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
            if (parsed.callbackURL) callbackURL = parsed.callbackURL;
            if (parsed.provider) provider = parsed.provider;
            if (parsed.redirectUri) redirectUri = parsed.redirectUri;
        } catch {}
    }

    if (error) {
        const errTarget = `${callbackURL}?error=${encodeURIComponent(String(error))}`;
        res.status(200);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${errTarget}"><script>window.location.replace(${JSON.stringify(errTarget)});</script></head><body>Redirecting...</body></html>`);
    }

    if (!code || typeof code !== 'string') {
        const errTarget = `${callbackURL}?error=missing_code`;
        res.status(200);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${errTarget}"><script>window.location.replace(${JSON.stringify(errTarget)});</script></head><body>Redirecting...</body></html>`);
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        let email = '';
        let name = '';
        let avatarUrl = '';

        let googleAccessToken = '';

        if (provider === 'google' || provider === 'youtube') {
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: process.env.GOOGLE_CLIENT_ID || '',
                    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            });
            const tokenData = await tokenRes.json();
            if (!tokenRes.ok || !tokenData.access_token) {
                console.error('[Google OAuth Token Exchange Error]', {
                    status: tokenRes.status,
                    error: tokenData,
                    redirectUri,
                    hasClientId: !!process.env.GOOGLE_CLIENT_ID,
                    hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
                });
                const errDetail = encodeURIComponent(tokenData.error_description || tokenData.error || 'token_exchange_failed');
                return res.redirect(`${callbackURL}?error=oauth_token_exchange_failed&details=${errDetail}`);
            }
            googleAccessToken = tokenData.access_token;

            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
            });
            const userData = await userRes.json();
            email = userData.email;
            name = userData.name || userData.email.split('@')[0];
            avatarUrl = userData.picture || '';
        } else {
            return res.redirect(`${callbackURL}?error=unsupported_provider`);
        }

        if (!email) {
            return res.redirect(`${callbackURL}?error=email_not_provided`);
        }

        email = email.toLowerCase().trim();

        // Check if user exists
        const existing = await sql`SELECT id, name, avatar_url FROM users WHERE email = ${email} LIMIT 1`;
        let userId: string;

        if (existing.length > 0) {
            userId = existing[0].id;
            if (avatarUrl && !existing[0].avatar_url) {
                await sql`UPDATE users SET avatar_url = ${avatarUrl} WHERE id = ${userId}`;
                await sql`UPDATE profiles SET avatar_url = ${avatarUrl} WHERE user_id = ${userId}`;
            }
        } else {
            userId = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
            const baseUsername = (name || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user';
            const username = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

            await sql`
                INSERT INTO users (id, email, name, avatar_url)
                VALUES (${userId}, ${email}, ${name}, ${avatarUrl})
            `;

            await sql`
                INSERT INTO profiles (id, user_id, name, username, display_name, avatar_url)
                VALUES (${userId}, ${userId}, ${name}, ${username}, ${name}, ${avatarUrl})
            `;

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
        }

        // Persist Google OAuth token into neon_auth.account table if present
        if (googleAccessToken) {
            try {
                const neonUser = await sql`
                    INSERT INTO neon_auth."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
                    VALUES (gen_random_uuid(), ${name}, ${email}, true, ${avatarUrl}, NOW(), NOW())
                    ON CONFLICT (email) DO UPDATE SET image = EXCLUDED.image, "updatedAt" = NOW()
                    RETURNING id;
                `;
                const neonUserId = neonUser[0]?.id;

                await sql`
                    INSERT INTO neon_auth.account (
                        id, "accountId", "providerId", "userId", "accessToken", "scope", "createdAt", "updatedAt"
                    ) VALUES (
                        gen_random_uuid(), ${email}, 'google', ${neonUserId}, ${googleAccessToken}, 'openid email profile https://www.googleapis.com/auth/youtube.readonly', NOW(), NOW()
                    );
                `;
            } catch (accErr) {
                console.warn('[Store Google Account Token in neon_auth.account]', accErr);
            }
        }

        const userObj = { id: userId, email, name };
        const token = await createToken(userObj);
        setSessionCookie(res, token);

        const targetUrl = new URL(callbackURL);
        targetUrl.searchParams.set('secret', token);
        if (googleAccessToken && provider === 'youtube') {
            targetUrl.searchParams.set('yt_token', googleAccessToken);
        }

        res.status(200);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0;url=${targetUrl.toString()}">
    <title>Connecting to Echoes...</title>
</head>
<body style="background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;">
        <h2 style="font-weight:500;margin-bottom:0.5rem;">Connecting your account...</h2>
        <p style="color:#888;font-size:0.9rem;">Redirecting to Echoes. If this page does not reload, <a href="${targetUrl.toString()}" style="color:#fff;text-decoration:underline;">click here</a>.</p>
    </div>
    <script>
        try {
            localStorage.setItem('echos-auth-token', ${JSON.stringify(token)});
            localStorage.setItem('monochrome-auth-token', ${JSON.stringify(token)});
            ${googleAccessToken && provider === 'youtube' ? `localStorage.setItem('echos_yt_token', ${JSON.stringify(googleAccessToken)});` : ''}
        } catch (e) {}
        window.location.replace(${JSON.stringify(targetUrl.toString())});
    </script>
</body>
</html>`);
    } catch (err: any) {
        console.error('[OAuth Callback Error]', err);
        const errTarget = `${callbackURL}?error=${encodeURIComponent(err.message || 'oauth_failed')}`;
        res.status(200);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="1;url=${errTarget}">
    <title>Authentication Error</title>
</head>
<body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;">
        <p style="color:#ef4444;font-size:1.1rem;margin-bottom:1rem;">Authentication error: ${err.message || 'oauth_failed'}</p>
        <p><a href="${errTarget}" style="color:#fff;">Click here to return to Echoes</a></p>
    </div>
    <script>window.location.replace(${JSON.stringify(errTarget)});</script>
</body>
</html>`);
    }
}
