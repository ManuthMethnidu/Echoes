import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const body = req.body || {};
        const imagePayload = body.image || body.dataUrl || body.data || body.file;

        if (!imagePayload || typeof imagePayload !== 'string') {
            return res.status(400).json({ error: 'Missing image data (base64 or data URL required)' });
        }

        let mimeType = 'image/jpeg';
        let ext = 'jpg';
        let base64Data = imagePayload;

        const dataUrlMatch = imagePayload.match(/^data:([a-zA-Z0-9/+-]+);base64,(.+)$/);
        if (dataUrlMatch) {
            mimeType = dataUrlMatch[1];
            base64Data = dataUrlMatch[2];
            if (mimeType.includes('webp')) ext = 'webp';
            else if (mimeType.includes('png')) ext = 'png';
            else if (mimeType.includes('gif')) ext = 'gif';
            else ext = 'jpg';
        }

        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty image buffer' });
        }

        if (buffer.length > 10 * 1024 * 1024) {
            return res.status(413).json({ error: 'Image exceeds maximum size (10MB)' });
        }

        // 1. Primary: Store in Neon Postgres custom_artworks table (hosted on echoes.mteck.tech)
        try {
            const sql = getDb();
            await ensureSchema(sql);

            const artId = 'art_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
            await sql`
                INSERT INTO custom_artworks (id, mime_type, base64)
                VALUES (${artId}, ${mimeType}, ${base64Data})
                ON CONFLICT (id) DO NOTHING
            `;

            const host = (req.headers['x-forwarded-host'] || req.headers.host || 'echoes.mteck.tech') as string;
            const proto = (req.headers['x-forwarded-proto'] || 'https') as string;
            const artworkUrl = `${proto}://${host}/api/artwork?id=${artId}`;

            return res.status(200).json({ ok: true, url: artworkUrl });
        } catch (dbErr) {
            console.warn('[Upload] DB storage failed, attempting external fallback:', dbErr);
        }

        // 2. Secondary: Catbox.moe
        try {
            const formData = new FormData();
            formData.append('reqtype', 'fileupload');
            const blob = new Blob([buffer], { type: mimeType });
            formData.append('fileToUpload', blob, `artwork_${Date.now()}.${ext}`);

            const catboxRes = await fetch('https://catbox.moe/user/api.php', {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Echoes/1.0',
                },
                body: formData,
            });

            const catboxText = (await catboxRes.text()).trim();
            if (catboxRes.ok && catboxText.startsWith('http')) {
                return res.status(200).json({ ok: true, url: catboxText });
            }
        } catch (catboxErr) {
            console.warn('[Upload] Catbox error, attempting Litterbox:', catboxErr);
        }

        // 3. Fallback: Litterbox
        try {
            const formData = new FormData();
            formData.append('reqtype', 'fileupload');
            formData.append('time', '72h');
            const blob = new Blob([buffer], { type: mimeType });
            formData.append('fileToUpload', blob, `artwork_${Date.now()}.${ext}`);

            const litterboxRes = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Echoes/1.0',
                },
                body: formData,
            });

            const litterboxText = (await litterboxRes.text()).trim();
            if (litterboxRes.ok && litterboxText.startsWith('http')) {
                return res.status(200).json({ ok: true, url: litterboxText });
            }
        } catch (litterboxErr) {
            console.warn('[Upload] Litterbox error:', litterboxErr);
        }

        return res.status(500).json({ error: 'Image hosting failed. Please try providing an image URL.' });
    } catch (err: any) {
        console.error('[Upload API error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error during upload' });
    }
}
