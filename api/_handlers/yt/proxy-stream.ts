import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'stream';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing ?url=' });
    }

    try {
        const headers: Record<string, string> = {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        };
        if (req.headers.range) {
            headers['range'] = req.headers.range;
        }

        const upstream = await fetch(url, { headers });
        res.status(upstream.status);

        for (const [k, v] of upstream.headers.entries()) {
            if (
                ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].includes(
                    k.toLowerCase()
                )
            ) {
                res.setHeader(k, v);
            }
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

        if (req.method === 'HEAD' || !upstream.body) {
            return res.end();
        }

        const readable = Readable.fromWeb(upstream.body as any);
        readable.on('error', () => {
            res.end();
        });
        res.on('close', () => {
            readable.destroy();
        });
        readable.pipe(res);
    } catch (err: any) {
        console.error('[Proxy Stream Error]', err);
        res.status(500).json({ error: err.message || 'Proxy error' });
    }
}
