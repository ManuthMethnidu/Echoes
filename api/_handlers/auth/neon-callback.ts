import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { createToken, setSessionCookie } from '../../_lib/auth.js';

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const error = req.query.error || req.query.error_description;
    if (error) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Authentication Error</title>
    <style>
        body { background: #0c0d0e; color: #fff; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 1rem; }
        .card { background: #18191b; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 2rem; max-width: 400px; text-align: center; }
        .icon { font-size: 32px; color: #ef4444; margin-bottom: 1rem; }
        .btn { display: inline-block; background: #fff; color: #000; padding: 0.6rem 1.25rem; border-radius: 9999px; text-decoration: none; font-weight: 600; margin-top: 1rem; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✕</div>
        <h2>Sign In Failed</h2>
        <p style="color:#9ca3af;font-size:0.9rem;">${escapeHtml(String(error))}</p>
        <a href="/index.html" class="btn">Return to Echoes</a>
    </div>
</body>
</html>`);
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const flowId = req.query.flow ? String(req.query.flow) : null;

        // Query the latest session created in Neon Auth
        const sessions = await sql`
            SELECT s."userId", s.token, u.email, u.name, u.image, s."createdAt"
            FROM neon_auth.session s
            JOIN neon_auth."user" u ON s."userId" = u.id
            WHERE s."createdAt" >= NOW() - INTERVAL '15 minutes'
            ORDER BY s."createdAt" DESC
            LIMIT 1;
        `;

        if (!sessions || sessions.length === 0) {
            console.warn('[Neon Callback] No recent session found in neon_auth.session');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="2;url=/index.html">
    <title>Redirecting to Echoes...</title>
</head>
<body style="background:#0c0d0e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;">
        <p>No active login session found. Redirecting to Echoes...</p>
        <p><a href="/index.html" style="color:#fff;">Click here if not redirected</a></p>
    </div>
</body>
</html>`);
        }

        const rawSession = sessions[0];
        const rawUserId = String(rawSession.userId);
        const email = String(rawSession.email || '').toLowerCase().trim();
        const name = String(rawSession.name || (email ? email.split('@')[0] : 'User')).trim();
        const avatarUrl = rawSession.image ? String(rawSession.image) : '';
        const neonToken = rawSession.token ? String(rawSession.token) : '';

        // Check if user already exists in custom users table
        const existingUsers = await sql`
            SELECT id, email, name, avatar_url FROM users WHERE email = ${email} OR id = ${rawUserId} LIMIT 1
        `;

        let finalUserId = rawUserId;
        if (existingUsers.length > 0) {
            finalUserId = existingUsers[0].id;
            if (avatarUrl && !existingUsers[0].avatar_url) {
                await sql`UPDATE users SET avatar_url = ${avatarUrl} WHERE id = ${finalUserId}`;
                await sql`UPDATE profiles SET avatar_url = ${avatarUrl} WHERE user_id = ${finalUserId}`;
            }
        } else {
            const baseUsername = name.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user';
            const username = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

            await sql`
                INSERT INTO users (id, email, name, avatar_url)
                VALUES (${finalUserId}, ${email}, ${name}, ${avatarUrl})
                ON CONFLICT (id) DO UPDATE SET avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
            `;

            await sql`
                INSERT INTO profiles (id, user_id, name, username, display_name, avatar_url)
                VALUES (${finalUserId}, ${finalUserId}, ${name}, ${username}, ${name}, ${avatarUrl})
                ON CONFLICT (id) DO UPDATE SET avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url)
            `;

            await sql`
                INSERT INTO user_sync_data (user_id, library, history, user_playlists, user_folders)
                VALUES (${finalUserId}, '{"tracks":{},"albums":{},"artists":{},"playlists":{},"mixes":{}}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb)
                ON CONFLICT (user_id) DO NOTHING
            `;
        }

        // Clean up consumed flow
        if (flowId) {
            await sql`DELETE FROM oauth_flows WHERE flow_id = ${flowId}`.catch(() => {});
        }

        // Generate application JWT
        const userObj = { id: finalUserId, email, name, avatar: avatarUrl };
        const appToken = await createToken(userObj);
        setSessionCookie(res, appToken);

        const safeUserJson = JSON.stringify({
            id: finalUserId,
            email,
            name,
            avatar: avatarUrl,
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Signed In to Echoes</title>
    <style>
        body {
            background-color: #0c0d0e;
            color: #f3f4f6;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 1.5rem;
            box-sizing: border-box;
        }
        .card {
            background: #18191b;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 2.25rem 2rem;
            max-width: 420px;
            width: 100%;
            text-align: center;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }
        .icon {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: rgba(34, 197, 94, 0.15);
            color: #22c55e;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            margin: 0 auto 1.25rem auto;
        }
        h2 { margin: 0 0 0.5rem 0; font-size: 1.35rem; font-weight: 600; }
        p { color: #9ca3af; font-size: 0.95rem; margin: 0 0 1.5rem 0; line-height: 1.5; }
        .btn {
            display: inline-block;
            background: #ffffff;
            color: #000000;
            padding: 0.75rem 1.5rem;
            border-radius: 9999px;
            text-decoration: none;
            font-size: 0.95rem;
            font-weight: 600;
            transition: opacity 0.2s;
        }
        .btn:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✓</div>
        <h2>Connected with Google</h2>
        <p>Signed in as <strong style="color: #fff;">${escapeHtml(name || email)}</strong>.<br>Synchronizing your account with Echoes...</p>
        <a href="/index.html" class="btn" id="return-btn">Return to Echoes</a>
    </div>
    <script>
        const token = ${JSON.stringify(appToken)};
        const neonSessionToken = ${JSON.stringify(neonToken)};
        const user = ${safeUserJson};

        try {
            localStorage.setItem('echos-auth-token', token);
            localStorage.setItem('monochrome-auth-token', token);
            if (neonSessionToken) {
                localStorage.setItem('better-auth.session_token', neonSessionToken);
            }
        } catch (e) {}

        const target = window.opener || window.parent;
        let notified = false;
        if (target && target !== window) {
            try {
                target.postMessage({
                    type: 'echos:auth-success',
                    token: token,
                    user: user
                }, '*');
                notified = true;
            } catch (e) {}
        }

        // Close popup after brief sync, or navigate if standalone tab
        if (notified) {
            setTimeout(() => {
                try { window.close(); } catch (e) {}
            }, 800);
        } else {
            setTimeout(() => {
                window.location.replace('/index.html');
            }, 1200);
        }
    </script>
</body>
</html>`);
    } catch (err: any) {
        console.error('[Neon Auth Callback Error]', err);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Authentication Error</title>
</head>
<body style="background:#0c0d0e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;">
        <p style="color:#ef4444;">Login processing error: ${escapeHtml(err.message || 'unknown_error')}</p>
        <p><a href="/index.html" style="color:#fff;">Click here to return to Echoes</a></p>
    </div>
</body>
</html>`);
    }
}