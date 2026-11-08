import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
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

// Early-resolving helper: returns first truthy candidate
async function findFirstValid<T>(promises: Promise<T | null>[]): Promise<T | null> {
    return new Promise((resolve) => {
        let remaining = promises.length;
        if (remaining === 0) return resolve(null);
        let resolved = false;

        promises.forEach((p) => {
            p.then((val) => {
                if (resolved) return;
                if (val) {
                    resolved = true;
                    resolve(val);
                } else {
                    remaining--;
                    if (remaining === 0) resolve(null);
                }
            }).catch(() => {
                if (resolved) return;
                remaining--;
                if (remaining === 0) resolve(null);
            });
        });
    });
}

function getCompanionRedirect(comp: string, videoId: string, itag: number): Promise<string | null> {
    return new Promise((resolve) => {
        const req = https.request(
            {
                protocol: 'https:',
                hostname: comp,
                path: `/companion/latest_version?id=${encodeURIComponent(videoId)}&itag=${itag}`,
                method: 'GET',
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
                timeout: 3000,
            },
            (res) => {
                const loc = res.headers.location;
                res.destroy();
                if ((res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307) && loc) {
                    return resolve(loc);
                }
                resolve(null);
            }
        );
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

async function fetchCompanionDirectStream(
    videoId: string,
    preferM4a: boolean = false
): Promise<{ streamUrl: string; mimeType: string; companion: string } | null> {
    const itag = preferM4a ? 140 : 251;
    let hash = 0;
    for (let i = 0; i < videoId.length; i++) {
        hash = (hash << 5) - hash + videoId.charCodeAt(i);
    }
    const startIndex = Math.abs(hash) % HEALTHY_COMPANIONS.length;
    const companionsToTry = [
        ...HEALTHY_COMPANIONS.slice(startIndex),
        ...HEALTHY_COMPANIONS.slice(0, startIndex),
    ];

    const checkCompanion = async (comp: string) => {
        const location = await getCompanionRedirect(comp, videoId, itag);
        if (location) {
            try {
                const u = new URL(location);
                const origHost = u.hostname;
                u.hostname = comp;
                u.searchParams.set('host', origHost);
                u.searchParams.delete('issuer');
                return {
                    streamUrl: u.toString(),
                    mimeType: preferM4a ? 'audio/mp4; codecs="mp4a.40.2"' : 'audio/webm; codecs="opus"',
                    companion: comp,
                };
            } catch (_) {}
        }
        return null;
    };

    // Parallel check top 3 candidates with early exit (< 900ms)
    const fastMatch = await findFirstValid(companionsToTry.slice(0, 3).map(checkCompanion));
    if (fastMatch) return fastMatch;

    return await findFirstValid(companionsToTry.slice(3).map(checkCompanion));
}

async function fetchStreamFromUrl(
    streamUrl: string,
    isHead: boolean,
    clientRange?: string
): Promise<Response | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(streamUrl, {
            method: isHead ? 'HEAD' : 'GET',
            signal: controller.signal,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Referer': 'https://yt.chocolatemoo53.com/',
                'Range': clientRange || 'bytes=0-',
            },
        });
        clearTimeout(timer);
        if (res.ok || res.status === 206) return res;
    } catch (_) {}
    return null;
}

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
    preferredCompanion?: string,
    clientRange?: string
): Promise<{ response: Response; companion: string } | null> {
    const parsed = new URL(rawUrl);
    const existingIssuer = parsed.searchParams.get('issuer');
    const firstChoice =
        existingIssuer && HEALTHY_COMPANIONS.includes(existingIssuer)
            ? existingIssuer
            : preferredCompanion && HEALTHY_COMPANIONS.includes(preferredCompanion)
            ? preferredCompanion
            : null;

    const companionsToTry = firstChoice
        ? [firstChoice, ...HEALTHY_COMPANIONS.filter((c) => c !== firstChoice)]
        : [...HEALTHY_COMPANIONS];

    const rangeValue = clientRange || 'bytes=0-';

    for (const companion of companionsToTry) {
        try {
            const compUrl = buildCompanionUrl(rawUrl, companion);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);

            const res = await fetch(compUrl, {
                method: isHead ? 'HEAD' : 'GET',
                signal: controller.signal,
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Referer': 'https://yt.chocolatemoo53.com/',
                    'Range': rangeValue,
                },
            });
            clearTimeout(timer);

            if (res.ok || res.status === 206) {
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
    const clientRange = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const isHead = req.method === 'HEAD';

    try {
        let audioRes: Response | null = null;
        let mimeType = 'audio/webm';
        let ext = 'opus';

        // 1. Direct companion stream fast-path (unexpired, IP-bound to companion)
        const directCompanion = await fetchCompanionDirectStream(videoId, false);
        if (directCompanion) {
            const streamRes = await fetchStreamFromUrl(directCompanion.streamUrl, isHead, clientRange);
            if (streamRes && (streamRes.ok || streamRes.status === 206)) {
                audioRes = streamRes;
                mimeType = directCompanion.mimeType.split(';')[0];
                ext = 'opus';
            }
        }

        let data: any = null;
        if (!audioRes) {
            try {
                const vidResult = await fetchWithFailover((base) => `${base}/api/v1/videos/${videoId}`, 3500);
                data = vidResult.data;
            } catch (directErr) {
                console.warn(`[YouTube Download] Direct lookup failed for ${videoId}:`, directErr);
            }
        }

        const adaptiveFormats = data?.adaptiveFormats || [];
        const unexpiredAudio = adaptiveFormats.filter(
            (f: any) => f.type && f.type.startsWith('audio') && f.url && !isFormatExpired(f.url)
        );

        let fallbackStreamUrl: string = directCompanion?.streamUrl || '';

        // 2. Try direct video audio formats if unexpired
        if (!audioRes && unexpiredAudio.length > 0) {
            unexpiredAudio.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
            const bestAudio = unexpiredAudio[0];
            mimeType = bestAudio.type?.split(';')[0] || 'audio/webm';
            ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'opus';

            let hash = 0;
            for (let i = 0; i < videoId.length; i++) {
                hash = (hash << 5) - hash + videoId.charCodeAt(i);
            }
            const preferred = HEALTHY_COMPANIONS[Math.abs(hash) % HEALTHY_COMPANIONS.length];
            fallbackStreamUrl = fallbackStreamUrl || buildCompanionUrl(bestAudio.url, preferred);

            const fetchResult = await fetchCompanionWithFailover(bestAudio.url, isHead, preferred, clientRange);
            if (fetchResult && (fetchResult.response.ok || fetchResult.response.status === 206)) {
                audioRes = fetchResult.response;
            }
        }

        // 3. Candidate failover: if direct audio was expired or companion fetch failed, search matching uploads
        if (!audioRes || (!audioRes.ok && audioRes.status !== 206)) {
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
                        3000
                    );
                    const candidates = Array.isArray(searchRes.data)
                        ? searchRes.data.filter((item: any) => (item.videoId || item.id) !== videoId)
                        : [];

                    if (candidates.length === 0) continue;

                    // Query candidate videos in parallel with early exit
                    const match = await findFirstValid(
                        candidates.slice(0, 5).map(async (candidate: any) => {
                            const cid = candidate.videoId || candidate.id;
                            if (!cid) return null;
                            try {
                                const cVideo = await fetchWithFailover(
                                    (base) => `${base}/api/v1/videos/${cid}`,
                                    3500
                                );
                                const cAdaptive = (cVideo.data?.adaptiveFormats || []).filter(
                                    (f: any) => f.type && f.type.startsWith('audio') && f.url && !isFormatExpired(f.url)
                                );
                                if (cAdaptive.length === 0) return null;

                                cAdaptive.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
                                const bestCandidateAudio = cAdaptive[0];
                                const candidateFetch = await fetchCompanionWithFailover(
                                    bestCandidateAudio.url,
                                    isHead,
                                    undefined,
                                    clientRange
                                );
                                if (candidateFetch && (candidateFetch.response.ok || candidateFetch.response.status === 206)) {
                                    return {
                                        response: candidateFetch.response,
                                        format: bestCandidateAudio,
                                        streamUrl: buildCompanionUrl(bestCandidateAudio.url, candidateFetch.companion),
                                    };
                                }
                            } catch (_) {}
                            return null;
                        })
                    );

                    if (match) {
                        audioRes = match.response;
                        fallbackStreamUrl = match.streamUrl || fallbackStreamUrl;
                        mimeType = match.format.type?.split(';')[0] || 'audio/webm';
                        ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'opus';
                        break;
                    }
                } catch (_) {}
            }
        }

        if (!audioRes || (!audioRes.ok && audioRes.status !== 206)) {
            // Client redirect fallback: redirect client directly to the companion stream URL
            // (Client residential/browser IPs are not subject to datacenter IP blocks)
            if (fallbackStreamUrl) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                if (typeof res.redirect === 'function') {
                    return res.redirect(302, fallbackStreamUrl);
                }
                res.writeHead(302, {
                    'Location': fallbackStreamUrl,
                    'Access-Control-Allow-Origin': '*',
                });
                return res.end();
            }
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

        const hasClientRange = Boolean(req.headers.range);
        const finalStatus = hasClientRange ? audioRes.status : audioRes.status === 206 ? 200 : audioRes.status;
        res.status(finalStatus);
        res.setHeader('Content-Type', mimeType);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(safeFilename)}"; filename*=UTF-8''${encodeURIComponent(
                safeFilename
            )}`
        );
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader(
            'Access-Control-Expose-Headers',
            'Content-Length, Content-Disposition, Content-Type, Content-Range, Accept-Ranges'
        );
        res.setHeader('Accept-Ranges', 'bytes');

        const cr = audioRes.headers.get('content-range');
        if (cr && hasClientRange) res.setHeader('Content-Range', cr);

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
