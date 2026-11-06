import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, ensureSchema } from '../../_lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        let id = req.query.id as string;
        if (!id && req.url) {
            const parts = req.url.split('?')[0].split('/');
            const lastPart = parts[parts.length - 1];
            if (lastPart && lastPart !== 'artwork') {
                id = lastPart.replace(/\.[a-zA-Z0-9]+$/, '');
            }
        }

        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'Missing artwork id parameter' });
        }

        id = id.trim();

        const sql = getDb();
        await ensureSchema(sql);

        const rows = await sql`
            SELECT mime_type, base64 FROM custom_artworks WHERE id = ${id} LIMIT 1
        `;

        if (!rows || rows.length === 0) {
            return res.status(404).send('Artwork not found');
        }

        const artwork = rows[0];
        const buffer = Buffer.from(artwork.base64, 'base64');

        res.setHeader('Content-Type', artwork.mime_type || 'image/jpeg');
        res.setHeader('Content-Length', buffer.length.toString());
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.status(200).end(buffer);
    } catch (err: any) {
        console.error('[Artwork API Error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
