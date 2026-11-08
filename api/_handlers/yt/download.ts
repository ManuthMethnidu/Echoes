import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover, isFormatExpired } from '../../_lib/invidious.js';
import { Readable } from 'stream';
import { sanitizeFilename } from '../../_lib/sanitize.js';

const HEALTHY_COMPANIONS = [
    'yt-comp1.chocolatemoo53.com',
    'yt-comp2.chocolatemoo53.com',
    'yt-comp3.chocolatemoo53.com',
    'yt-comp4.chocolatemoo53.com',
    'yt-comp5.chocolatemoo53.com',
    'yt-comp6.chocolatemoo53.com',
];

function buildCompanionUrl(rawUrl: string, companion: string): string {
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
    parsed.searchParams.delete('issuer');
    return `https://${companion}${parsed.pathname}${parsed.search}`;
}

async function fetchCompanionWithFailover(
    rawUrl: string,
    isHead: boolean,
    preferredCompanion?: string
): Promise<{ response: Response; companion: string } | null> {
    const companionsToTry =
        preferredCompanion && HEALTHY_COMPANIONS.includes(preferredCompanion)
            ? [preferredCompanion, ...HEALTHY_COMPANIONS.filter((c) => c !== preferredCompanion)]
            : [...HEALTHY_COMPANIONS];

    for (const companion of companionsToTry) {
        try {
            const compUrl = buildCompanionUrl(rawUrl, companion);
            const res = await fetch(compUrl, {
                method: isHead ? 'HEAD' : 'GET',
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Referer': 'https://yt.chocolatemoo53.com/',
                },
            });
            if (res.ok) {
                return { response: res, companion };
            }
            if (res.status !== 403 && res.status !== 429 && res.status !== 503) {
                return { response: res, companion };
            }
        } catch (_) {}
    }
    return null;
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

    const titleParam = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const artistParam = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';

    try {
        let data: any = null;
        try {
            const vidResult = await fetchWithFailover((base) => `${base}/api/v1/videos/${videoId}`, 4000);
            data = vidResult.data;
        } catch (directErr) {
            console.warn(`[YouTube Download] Direct lookup failed for ${videoId}:`, directErr);
        }

        const adaptiveFormats = data?.adaptiveFormats || [];
        const unexpiredAudio = adaptiveFormats.filter(
            (f: any) => f.type && f.type.startsWith('audio') && f.url && !isFormatExpired(f.url)
        );

        let audioRes: Response | null = null;
        let mimeType = 'audio/webm';
        let ext = 'opus';
        const isHead = req.method === 'HEAD';

        // 1. Try direct video audio formats if unexpired
        if (unexpiredAudio.length > 0) {
            unexpiredAudio.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
            const bestAudio = unexpiredAudio[0];
            mimeType = bestAudio.type?.split(';')[0] || 'audio/webm';
            ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'opus';

            let hash = 0;
            for (let i = 0; i < videoId.length; i++) {
                hash = (hash << 5) - hash + videoId.charCodeAt(i);
            }
            const preferred = HEALTHY_COMPANIONS[Math.abs(hash) % HEALTHY_COMPANIONS.length];
            const fetchResult = await fetchCompanionWithFailover(bestAudio.url, isHead, preferred);
            if (fetchResult && fetchResult.response.ok) {
                audioRes = fetchResult.response;
            }
        }

        // 2. Candidate failover: if direct audio was expired or companion fetch failed, search matching uploads
        if (!audioRes || !audioRes.ok) {
            console.log(`[YouTube Download] Direct audio unavailable for ${videoId}; initiating candidate failover search`);
            const cleanTitle = (titleParam || data?.title || '').trim();
            const cleanArt = (artistParam || data?.author || '').replace(/\s*-\s*Topic\b/gi, '').trim();
            const searchTerms = [
                cleanTitle && cleanArt ? `${cleanTitle} ${cleanArt}` : '',
                cleanTitle,
            ].filter(Boolean);

            for (const query of searchTerms) {
                try {
                    const searchRes = await fetchWithFailover(
                        (base) => `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
                        3500
                    );
                    const candidates = Array.isArray(searchRes.data)
                        ? searchRes.data.filter((item: any) => (item.videoId || item.id) !== videoId)
                        : [];

                    for (const candidate of candidates.slice(0, 4)) {
                        const cid = candidate.videoId || candidate.id;
                        if (!cid) continue;
                        try {
                            const cVideo = await fetchWithFailover(
                                (base) => `${base}/api/v1/videos/${cid}`,
                                3500
                            );
                            const cAdaptive = (cVideo.data?.adaptiveFormats || []).filter(
                                (f: any) => f.type && f.type.startsWith('audio') && f.url && !isFormatExpired(f.url)
                            );
                            if (cAdaptive.length > 0) {
                                cAdaptive.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
                                const bestCandidateAudio = cAdaptive[0];
                                const candidateFetch = await fetchCompanionWithFailover(bestCandidateAudio.url, isHead);
                                if (candidateFetch && candidateFetch.response.ok) {
                                    audioRes = candidateFetch.response;
                                    mimeType = bestCandidateAudio.type?.split(';')[0] || 'audio/webm';
                                    ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'opus';
                                    break;
                                }
                            }
                        } catch (_) {}
                    }
                    if (audioRes && audioRes.ok) break;
                } catch (_) {}
            }
        }

        if (!audioRes || !audioRes.ok) {
            const status = audioRes ? audioRes.status : 404;
            return res.status(status).json({ error: `Failed to download audio stream (HTTP ${status})` });
        }

        const cleanBase = sanitizeFilename(
            filename && typeof filename === 'string'
                ? filename.replace(new RegExp(`\\.${ext}$`, 'i'), '')
                : data?.title || titleParam || 'track',
            'track'
        );
        const safeFilename = `${cleanBase}.${ext}`;

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
