import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../../_lib/invidious.js';
import { Readable } from 'stream';

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

        if (streamUrl && instance) {
            if (streamUrl.startsWith('/')) {
                streamUrl = `${instance}${streamUrl}`;
            } else {
                streamUrl = streamUrl.replace(/^https:\/\/[^\/]+/, instance);
            }
        }

        const safeFilename =
            filename && typeof filename === 'string'
                ? filename.trim().endsWith(`.${ext}`)
                    ? filename.trim()
                    : `${filename.trim()}.${ext}`
                : `${(data.title || 'track').replace(/[\/\\?%*:|"<>]/g, '_')}.${ext}`;

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
