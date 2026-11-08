import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'stream';
import { sanitizeUrl, isPrivateOrBlockedHost } from '../../_lib/sanitize.js';

// Approved media streaming domains
const ALLOWED_STREAM_DOMAINS = [
    'googlevideo.com',
    'youtube.com',
    'ytimg.com',
    'invidious.io',
    'nadeko.net',
    'snopyta.org',
    'drgns.space',
    'privacydev.net',
    'lunar.icu',
    'perennialte.ch',
    'adminforge.de',
    'projectsegfau.lt',
    'chocolatemoo53.com',
    'materialio.us',
    'protokolla.fi',
    'ducks.party',
    'qzz.io',
];

function isAllowedDomain(hostname: string): boolean {
    const lowerHost = hostname.toLowerCase();
    return ALLOWED_STREAM_DOMAINS.some(
        (domain) => lowerHost === domain || lowerHost.endsWith('.' + domain)
    );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
        return res.status(204).end();
    }

    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing ?url=' });
    }

    const validatedUrl = sanitizeUrl(url, 8192);
    if (!validatedUrl) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    if (isPrivateOrBlockedHost(validatedUrl)) {
        return res.status(403).json({ error: 'Access to private or internal addresses is forbidden' });
    }

    try {
        const headers: Record<string, string> = {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        };
        if (req.headers.range) {
            headers['range'] = req.headers.range;
        }

        let currentUrl = validatedUrl;
        let redirectCount = 0;
        const maxRedirects = 3;
        let upstream: Response | null = null;

        while (redirectCount <= maxRedirects) {
            const parsed = new URL(currentUrl);
            if (!isAllowedDomain(parsed.hostname)) {
                return res.status(403).json({ error: 'Domain not permitted for streaming proxy' });
            }
            if (isPrivateOrBlockedHost(currentUrl)) {
                return res.status(403).json({ error: 'Access to private or internal addresses is forbidden' });
            }

            upstream = await fetch(currentUrl, {
                headers,
                redirect: 'manual',
            });

            if ([301, 302, 303, 307, 308].includes(upstream.status)) {
                const loc = upstream.headers.get('location');
                if (!loc) break;
                const nextUrl = new URL(loc, currentUrl).toString();
                const sanitizedNext = sanitizeUrl(nextUrl, 8192);
                if (!sanitizedNext) {
                    return res.status(400).json({ error: 'Invalid redirect URL format' });
                }
                currentUrl = sanitizedNext;
                redirectCount++;
                continue;
            }

            break;
        }

        if (!upstream) {
            return res.status(502).json({ error: 'Failed to connect to streaming host' });
        }

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
