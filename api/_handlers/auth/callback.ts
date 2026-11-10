import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import {
    createToken,
    setSessionCookie,
    getSafeOrigin,
    sanitizeCallbackUrl,
    extractOAuthStateCookie,
    clearOAuthStateCookie,
    verifySignedOAuthState,
    constantTimeEqualStrings,
} from '../../_lib/auth.js';

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function safeJsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
}

function sendRedirectHtml(
    res: VercelResponse,
    statusCode: number,
    targetUrl: string,
    message = 'Redirecting...'
) {
    res.status(statusCode);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escapeHtml(targetUrl)}"><script>window.location.replace(${safeJsonForScript(targetUrl)});</script></head><body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:2rem;">${escapeHtml(message)}</body></html>`
    );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    clearOAuthStateCookie(res, req);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    const { code, state, error } = req.query;
    const origin = getSafeOrigin(req);

    let callbackURL = `${origin}/index.html`;
    let provider = 'google';
    let redirectUri = `${origin}/api/auth/callback`;

    // Strict OAuth CSRF / State Protection (RFC 6749 §10.12)
    const stateParam = typeof state === 'string' ? state.trim() : '';
    const stateCookieToken = extractOAuthStateCookie(req);

    if (!stateParam || !stateCookieToken) {
        return sendRedirectHtml(res, 403, `${callbackURL}?error=invalid_oauth_state`, 'Invalid OAuth state. Redirecting...');
    }

    const cookieState = await verifySignedOAuthState(stateCookieToken);
    let stateValid = false;
    if (cookieState) {
        if (constantTimeEqualStrings(stateParam, cookieState.nonce)) {
            stateValid = true;
        } else {
            const queryStateJwt = await verifySignedOAuthState(stateParam);
            if (
                queryStateJwt &&
                constantTimeEqualStrings(queryStateJwt.nonce, cookieState.nonce) &&
                constantTimeEqualStrings(queryStateJwt.flowId, cookieState.flowId)
            ) {
                stateValid = true;
            }
        }
    }

    if (!stateValid || !cookieState) {
        return sendRedirectHtml(res, 403, `${callbackURL}?error=invalid_oauth_state`, 'Invalid OAuth state. Redirecting...');
    }

    if (cookieState.callbackURL) callbackURL = sanitizeCallbackUrl(cookieState.callbackURL, origin);
    if (cookieState.provider) provider = cookieState.provider;
    if (cookieState.redirectUri) redirectUri = sanitizeCallbackUrl(cookieState.redirectUri, origin);

    if (error) {
        return sendRedirectHtml(res, 200, `${callbackURL}?error=${encodeURIComponent(String(error))}`);
    }

    if (!code || typeof code !== 'string') {
        return sendRedirectHtml(res, 200, `${callbackURL}?error=missing_code`);
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        // Consume one-time DB flow record bound to signed state cookie
        interface ConsumedFlowRow {
            flow_id?: string;
            state_nonce?: string | null;
        }
        const consumedFlows = (await sql`
            DELETE FROM oauth_flows
            WHERE flow_id = ${cookieState.flowId} AND expires_at > NOW()
            RETURNING flow_id, state_nonce
        `.catch(() => [])) as ConsumedFlowRow[];

        const consumedFlow = consumedFlows?.[0];
        if (
            !consumedFlow?.state_nonce ||
            !constantTimeEqualStrings(String(consumedFlow.state_nonce), cookieState.nonce)
        ) {
            return sendRedirectHtml(res, 403, `${callbackURL}?error=invalid_oauth_state`, 'Invalid or expired OAuth flow. Redirecting...');
        }

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
        const safeTargetStr = targetUrl.toString();
        return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0;url=${escapeHtml(safeTargetStr)}">
    <title>Connecting to Echoes...</title>
</head>
<body style="background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;">
        <h2 style="font-weight:500;margin-bottom:0.5rem;">Connecting your account...</h2>
        <p style="color:#888;font-size:0.9rem;">Redirecting to Echoes. If this page does not reload, <a href="${escapeHtml(safeTargetStr)}" style="color:#fff;text-decoration:underline;">click here</a>.</p>
    </div>
    <script>
        try {
            localStorage.setItem('echos-auth-token', ${safeJsonForScript(token)});
            localStorage.setItem('monochrome-auth-token', ${safeJsonForScript(token)});
            ${googleAccessToken && provider === 'youtube' ? `localStorage.setItem('echos_yt_token', ${safeJsonForScript(googleAccessToken)});` : ''}
        } catch (e) {}
        window.location.replace(${safeJsonForScript(safeTargetStr)});
    </script>
</body>
</html>`);
    } catch (err: any) {
        console.error('[OAuth Callback Error]', err);
        const errMsg = err?.message || 'oauth_failed';
        const errTarget = `${callbackURL}?error=${encodeURIComponent(errMsg)}`;
        res.status(200);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="1;url=${escapeHtml(errTarget)}">
    <title>Authentication Error</title>
</head>
<body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;">
        <p style="color:#ef4444;font-size:1.1rem;margin-bottom:1rem;">Authentication error: ${escapeHtml(errMsg)}</p>
        <p><a href="${escapeHtml(errTarget)}" style="color:#fff;">Click here to return to Echoes</a></p>
    </div>
    <script>window.location.replace(${safeJsonForScript(errTarget)});</script>
</body>
</html>`);
    }
}
