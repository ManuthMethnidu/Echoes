import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../../_lib/db.js';
import {
    getSafeOrigin,
    generateOAuthStateNonce,
    createSignedOAuthState,
    setOAuthStateCookie,
    clearOAuthStateCookie,
} from '../../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    try {
        const payload = req.method === 'POST' ? req.body || {} : req.query || {};
        const { provider } = payload;
        const origin = getSafeOrigin(req);

        const neonAuthUrl =
            (typeof process !== 'undefined' ? process.env?.NEON_AUTH_BASE_URL : undefined) ||
            'https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth';

        if (!provider || provider === 'google' || provider === 'youtube') {
            const flowProvider = provider === 'youtube' ? 'youtube' : 'google';
            const flowId = crypto.randomUUID();
            const stateNonce = generateOAuthStateNonce();
            const sql = getDb();

            try {
                await ensureSchema(sql);

                // Opportunistically clean up expired flows
                await sql`DELETE FROM oauth_flows WHERE expires_at <= NOW()`.catch(() => {});

                await sql`
                    INSERT INTO oauth_flows (flow_id, provider, state_nonce)
                    VALUES (${flowId}, ${flowProvider}, ${stateNonce})
                `;

                const signedState = await createSignedOAuthState({
                    flowId,
                    nonce: stateNonce,
                    provider: flowProvider,
                });
                setOAuthStateCookie(res, signedState, req);

                const targetCallback = `${origin}/api/auth/callback/neon?flow=${encodeURIComponent(flowId)}&state=${encodeURIComponent(stateNonce)}`;

                const neonRes = await fetch(`${neonAuthUrl}/sign-in/social`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: 'google',
                        callbackURL: targetCallback,
                    }),
                });
                const neonData = (await neonRes.json()) as {
                    url?: string;
                    message?: string;
                    error?: string;
                } | null;
                if (neonData?.url && /^https?:\/\//i.test(String(neonData.url))) {
                    if (req.method === 'GET') {
                        return res.redirect(302, neonData.url);
                    }
                    return res.status(200).json({ url: neonData.url, redirectUrl: neonData.url, redirect: true });
                }

                // Clean up unused flow if upstream initiation failed
                await sql`DELETE FROM oauth_flows WHERE flow_id = ${flowId}`.catch(() => {});
                clearOAuthStateCookie(res, req);

                console.error('[Neon Auth Social Sign-In Response]', neonData);
                return res.status(neonRes.status || 400).json({
                    error: {
                        message:
                            neonData?.message ||
                            neonData?.error ||
                            'Failed to initiate Google sign-in with Neon Auth',
                    },
                });
            } catch (neonErr: any) {
                await sql`DELETE FROM oauth_flows WHERE flow_id = ${flowId}`.catch(() => {});
                clearOAuthStateCookie(res, req);
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