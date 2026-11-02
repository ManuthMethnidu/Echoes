import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../_lib/db.js';
import { createToken, setSessionCookie } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { code, state, error } = req.query;
    const origin = req.headers.origin || `https://${req.headers.host}`;

    let callbackURL = `${origin}/index.html`;
    let provider = 'google';

    if (state && typeof state === 'string') {
        try {
            const parsed = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
            if (parsed.callbackURL) callbackURL = parsed.callbackURL;
            if (parsed.provider) provider = parsed.provider;
        } catch {}
    }

    if (error) {
        return res.redirect(`${callbackURL}?error=${encodeURIComponent(String(error))}`);
    }

    if (!code || typeof code !== 'string') {
        return res.redirect(`${callbackURL}?error=missing_code`);
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        let email = '';
        let name = '';
        let avatarUrl = '';

        const redirectUri = `${origin}/api/auth/callback`;

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
                return res.redirect(`${callbackURL}?error=oauth_token_exchange_failed`);
            }
            googleAccessToken = tokenData.access_token;

            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
            });
            const userData = await userRes.json();
            email = userData.email;
            name = userData.name || userData.email.split('@')[0];
            avatarUrl = userData.picture || '';
        } else if (provider === 'github') {
            const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    client_id: process.env.GITHUB_CLIENT_ID || '',
                    client_secret: process.env.GITHUB_CLIENT_SECRET || '',
                    code,
                    redirect_uri: redirectUri,
                }),
            });
            const tokenData = await tokenRes.json();
            if (!tokenRes.ok || !tokenData.access_token) {
                return res.redirect(`${callbackURL}?error=oauth_token_exchange_failed`);
            }

            const userRes = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    'User-Agent': 'echos-Music-App',
                },
            });
            const userData = await userRes.json();

            // Fetch emails if private
            if (!userData.email) {
                const emailsRes = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        'User-Agent': 'echos-Music-App',
                    },
                });
                const emails = await emailsRes.json();
                const primary = Array.isArray(emails) ? emails.find((e: any) => e.primary) : null;
                email = primary ? primary.email : `${userData.login}@users.noreply.github.com`;
            } else {
                email = userData.email;
            }

            name = userData.name || userData.login;
            avatarUrl = userData.avatar_url || '';
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
        return res.redirect(targetUrl.toString());
    } catch (err: any) {
        console.error('[OAuth Callback Error]', err);
        return res.redirect(`${callbackURL}?error=${encodeURIComponent(err.message || 'oauth_failed')}`);
    }
}
