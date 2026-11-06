import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import { generateQrDataUrl } from '../../_lib/qr.js';
import { sanitizeString } from '../../_lib/sanitize.js';
import { getClientIp, consumeRateLimit } from '../../_lib/rateLimit.js';

// Generate cryptographically secure human-friendly 6-character code (excluding ambiguous chars: 0, O, 1, I, L)
function generatePairingCode(): string {
    const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    const rand = new Uint8Array(6);
    crypto.getRandomValues(rand);
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(rand[i] % chars.length);
    }
    return code;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const clientIp = getClientIp(req);
    const limit = await consumeRateLimit(`pair_init:${clientIp}`, 15, 600);
    if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many device pairing requests. Please wait a few minutes.' });
    }

    try {
        const sql = getDb();
        await ensureSchema(sql);

        const id = 'pair_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const code = generatePairingCode();
        const pairingToken = 'ptok_' + crypto.randomUUID().replace(/-/g, '');
        const deviceInfo = sanitizeString(req.headers['user-agent'] || 'Smart TV / Browser', 150);

        // Expire in 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await sql`
            INSERT INTO device_pairings (id, code, pairing_token, status, device_info, expires_at)
            VALUES (${id}, ${code}, ${pairingToken}, 'pending', ${deviceInfo}, ${expiresAt}::timestamptz)
        `;

        const origin = req.headers.origin || `https://${req.headers.host}`;
        const pairUrl = `${origin}/pair?code=${code}`;
        const qrDataUrl = await generateQrDataUrl(pairUrl);

        return res.status(200).json({
            id,
            code,
            formattedCode: `${code.slice(0, 3)} - ${code.slice(3)}`,
            pairingToken,
            pairUrl,
            qrDataUrl,
            expiresInSeconds: 600,
        });
    } catch (err: any) {
        console.error('[Pair Init Error]', err);
        return res.status(500).json({ error: err.message || 'Failed to initialize TV pairing' });
    }
}
