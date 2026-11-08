import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../../_lib/invidious.js';
import { Readable } from 'stream';
import { sanitizeFilename } from '../../_lib/sanitize.js';

const HEALTHY_COMPANIONS = [
    'yt-comp1.chocolatemoo53.com',
    'yt-comp2.chocolatemoo53.com',
    'yt-comp3.chocolatemoo53.com',
    'yt-comp4.chocolatemoo53.com',
    'yt-comp5.chocolatemoo53.com',
];

function resolveStreamUrl(rawUrl: string, videoId?: string): string {
    if (!rawUrl) return rawUrl;
    try {
        const parsed = new URL(rawUrl);
        let origHost = parsed.hostname;
        if (!origHost.includes('googlevideo.com')) {
            const mvi = parsed.searchParams.get('mvi') || '1';
            const mn = parsed.searchParams.get('mn')?.split(',')[0];
            if (mn) {
                origHost = `rr${mvi}---${mn}.googlevideo.com`;
            }
        }
        parsed.searchParams.set('host', origHost);

        let companion = '';
        const existingIssuer = parsed.searchParams.get('issuer');
        if (existingIssuer && HEALTHY_COMPANIONS.includes(existingIssuer)) {
            companion = existingIssuer;
        } else if (videoId) {
            let hash = 0;
            for (let i = 0; i < videoId.length; i++) {
                hash = (hash << 5) - hash + videoId.charCodeAt(i);
            }
            const idx = Math.abs(hash) % HEALTHY_COMPANIONS.length;
            companion = HEALTHY_COMPANIONS[idx];
        } else {
            companion = HEALTHY_COMPANIONS[Math.floor(Math.random() * HEALTHY_COMPANIONS.length)];
        }

        parsed.searchParams.delete('issuer');
        return `https://${companion}${parsed.pathname}${parsed.search}`;
    } catch {}
    return rawUrl;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Range');
        return res.status(204).end();
    }

    let { id, filename } = req.query;
    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing track ?id=' });
    }

    const videoId = id.replace(/^yt:/, '').trim();
    if (!/^[a-zA-Z0-9_-]{5,30}$/.test(videoId)) {
        return res.status(400).json({ error: 'Invalid track ID format' });
    }

    try {
        const { data, instance } = await fetchWithFailover((base) => `${base}/api/v1/videos/${videoId}`);

        const adaptiveFormats = data.adaptiveFormats || [];
        const audioFormats = adaptiveFormats.filter((f: any) => f.type && f.type.startsWith('audio') && f.url);

        let streamUrl = '';
        let rawUrl = '';
        let mimeType = 'audio/webm';
        let ext = 'opus';

        if (audioFormats.length > 0) {
            audioFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
            const bestAudio = audioFormats[0];
            rawUrl = bestAudio.url;
            streamUrl = bestAudio.url;
            mimeType = bestAudio.type?.split(';')[0] || 'audio/webm';
            ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'opus';
        } else if (data.formatStreams && data.formatStreams.length > 0) {
            rawUrl = data.formatStreams[0].url;
            streamUrl = data.formatStreams[0].url;
            mimeType = data.formatStreams[0].type?.split(';')[0] || 'audio/mp4';
            ext = 'm4a';
        }

        if (!streamUrl) {
            return res.status(404).json({ error: 'Audio stream not found' });
        }

        if (streamUrl) {
            streamUrl = resolveStreamUrl(streamUrl, videoId);
        }

        const cleanBase = sanitizeFilename(
            filename && typeof filename === 'string' ? filename.replace(new RegExp(`\\.${ext}$`, 'i'), '') : data.title || 'track',
            'track'
        );
        const safeFilename = `${cleanBase}.${ext}`;

        const isHead = req.method === 'HEAD';
        let audioRes = await fetch(streamUrl, {
            method: isHead ? 'HEAD' : 'GET',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
        });

        // If instance proxy failed and we had an original URL, try direct
        if (!audioRes.ok && rawUrl && rawUrl !== streamUrl) {
            try {
                const fallbackRes = await fetch(rawUrl, {
                    method: isHead ? 'HEAD' : 'GET',
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    },
                });
                if (fallbackRes.ok) {
                    audioRes = fallbackRes;
                }
            } catch (_) {}
        }

        if (!audioRes.ok) {
            return res.status(audioRes.status).json({ error: `Upstream returned HTTP ${audioRes.status}` });
        }

        res.status(audioRes.status);
        res.setHeader('Content-Type', mimeType);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(safeFilename)}"; filename*=UTF-8''${encodeURIComponent(
                safeFilename
            )}`
        );
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition, Content-Type');

        const cl = audioRes.headers.get('content-length');
        if (cl) res.setHeader('Content-Length', cl);

        if (isHead || !audioRes.body) return res.end();
        const readable = Readable.fromWeb(audioRes.body as any);
        readable.on('error', () => {
            // Client closed connection early (e.g. aborted download)
            res.end();
        });
        res.on('close', () => {
            readable.destroy();
        });
        readable.pipe(res);
    } catch (err: any) {
        console.error('[Download Error]', err);
        res.status(500).json({ error: err.message || 'Download error' });
    }
}
