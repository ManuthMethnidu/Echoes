import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';

const PODCASTINDEX_API_BASE = 'https://api.podcastindex.org/api/1.0';
const PODCAST_API_KEY = process.env.PODCAST_API_KEY || 'YU5HMSDYBQQVYDF6QN4P';
const PODCAST_API_SECRET = process.env.PODCAST_API_SECRET || '8hCvpjSL7T$S7^5ftnf5MhqQwYUYVjM^fmUL3Ld$';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // Extract target endpoint from query or path
        let endpoint = (req.query.endpoint as string) || '';

        if (!endpoint) {
            // Check if passed via subpath like /api/podcasts/trending
            const routeParam = req.query.__route as string | undefined;
            if (routeParam && routeParam.startsWith('podcasts/')) {
                endpoint = routeParam.slice('podcasts/'.length);
            }
        }

        if (!endpoint) {
            return res.status(400).json({ error: 'Missing endpoint parameter' });
        }

        if (!endpoint.startsWith('/')) {
            endpoint = '/' + endpoint;
        }

        const targetUrl = new URL(`${PODCASTINDEX_API_BASE}${endpoint}`);

        // Forward additional query parameters if endpoint did not already include them
        for (const [key, val] of Object.entries(req.query)) {
            if (key !== 'endpoint' && key !== '__route') {
                if (Array.isArray(val)) {
                    val.forEach((v) => targetUrl.searchParams.append(key, v));
                } else if (typeof val === 'string') {
                    targetUrl.searchParams.set(key, val);
                }
            }
        }

        const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
        const combined = PODCAST_API_KEY + PODCAST_API_SECRET + apiHeaderTime;
        const authHeader = crypto.createHash('sha1').update(combined).digest('hex');

        const headers = {
            'User-Agent': 'Echoes/1.0',
            'X-Auth-Key': PODCAST_API_KEY,
            'X-Auth-Date': apiHeaderTime,
            Authorization: authHeader,
        };

        const upstreamRes = await fetch(targetUrl.toString(), {
            method: 'GET',
            headers,
        });

        if (!upstreamRes.ok) {
            return res.status(upstreamRes.status).json({
                error: `PodcastIndex API error: ${upstreamRes.status}`,
            });
        }

        const data = await upstreamRes.json();

        // Edge cache for 5 minutes (stale while revalidate for 10 minutes)
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        return res.status(200).json(data);
    } catch (err: any) {
        console.error('[PodcastIndex Proxy Error]', err);
        return res.status(500).json({
            error: err.message || 'PodcastIndex request failed',
        });
    }
}
