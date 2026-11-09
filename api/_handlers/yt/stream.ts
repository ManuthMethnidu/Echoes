import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
import { fetchWithFailover, isFormatExpired } from '../../_lib/invidious.js';

const HEALTHY_COMPANIONS = [
    'yt-comp1.chocolatemoo53.com',
    'yt-comp2.chocolatemoo53.com',
    'yt-comp3.chocolatemoo53.com',
    'yt-comp4.chocolatemoo53.com',
    'yt-comp5.chocolatemoo53.com',
    'yt-comp6.chocolatemoo53.com',
];

// Early-resolving helper: returns the first truthy result without waiting for the rest
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

async function isStreamPlayable(url: string, timeoutMs: number = 2000): Promise<boolean> {
    if (!url) return false;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Range': 'bytes=0-50',
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
            signal: controller.signal,
        });
        clearTimeout(timer);
        return res.status === 200 || res.status === 206;
    } catch {
        return false;
    }
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
                    'Referer': 'https://yt.chocolatemoo53.com/',
                    'Origin': 'https://yt.chocolatemoo53.com',
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
            const playable = await isStreamPlayable(location);
            if (playable) {
                return {
                    streamUrl: location,
                    mimeType: preferM4a ? 'audio/mp4; codecs="mp4a.40.2"' : 'audio/webm; codecs="opus"',
                    companion: comp,
                };
            }
        }
        return null;
    };

    // Parallel check top 3 candidates with early exit (< 900ms)
    const fastMatch = await findFirstValid(companionsToTry.slice(0, 3).map(checkCompanion));
    if (fastMatch) return fastMatch;

    return await findFirstValid(companionsToTry.slice(3).map(checkCompanion));
}

function resolveStreamUrl(rawUrl: string, videoId?: string): string {
    if (!rawUrl) return rawUrl;
    try {
        const parsed = new URL(rawUrl);
        // If it's already a direct GoogleVideo stream, return it
        if (parsed.hostname.includes('googlevideo.com')) {
            return rawUrl;
        }
        return rawUrl;
    } catch {}
    return rawUrl;
}

function cleanArtist(rawArtist: string): string {
    if (!rawArtist) return '';
    return rawArtist
        .replace(/\s*-\s*Topic\b/gi, '')
        .replace(/\bTopic\b/gi, '')
        .replace(/\bOfficial\b/gi, '')
        .replace(/\bVEVO\b/gi, '')
        .trim();
}

function cleanSearchQuery(q: string): string {
    return q
        .replace(/[^\w\s\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function scoreCandidate(candidate: any, cleanTit: string, cleanArt: string, targetDuration: number): number {
    let score = 0;
    const cTitle = (candidate.title || '').toLowerCase();
    const tTitle = cleanTit.toLowerCase();

    // Exact title match or word-boundary match
    if (tTitle) {
        if (cTitle === tTitle) {
            score += 60;
        } else if (
            new RegExp(`(^|\\s|[-_\\[(])${tTitle.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}($|\\s|[-_\\])])`, 'i').test(
                cTitle
            )
        ) {
            score += 50;
        } else if (cTitle.includes(tTitle)) {
            score += 25;
        }
    }

    // Artist match
    if (cleanArt && cTitle.includes(cleanArt.toLowerCase())) {
        score += 20;
    }

    // Duration closeness (if within 5 seconds, big bonus)
    const cDuration = Number(candidate.lengthSeconds) || 0;
    if (targetDuration > 0 && cDuration > 0) {
        const diff = Math.abs(cDuration - targetDuration);
        if (diff <= 3) score += 40;
        else if (diff <= 10) score += 25;
        else if (diff <= 30) score += 10;
        else if (diff > 120) score -= 25;
    }

    // Penalize compilations or multi-track mixes
    if (/full\s*(ost|album|soundtrack)|all\s*songs|playlist/i.test(cTitle)) {
        score -= 40;
    }

    return score;
}

async function findPlayableAudio(
    videoData: any,
    preferM4a: boolean = false,
    videoId?: string
): Promise<{ format: any; streamUrl: string; issuer: string } | null> {
    if (!videoData) return null;

    const vId = videoId || videoData.videoId || videoData.id;

    // Check adaptive formats (audio-only formats) that are not expired
    const adaptiveFormats = (videoData.adaptiveFormats || []).filter(
        (f: any) => f.type && f.type.startsWith('audio') && f.url && !isFormatExpired(f.url)
    );

    if (preferM4a) {
        adaptiveFormats.sort((a: any, b: any) => {
            const aIsMp4 = a.type?.includes('mp4') || a.type?.includes('m4a');
            const bIsMp4 = b.type?.includes('mp4') || b.type?.includes('m4a');
            if (aIsMp4 && !bIsMp4) return -1;
            if (!aIsMp4 && bIsMp4) return 1;
            return (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0);
        });
    } else {
        adaptiveFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
    }

    for (const best of adaptiveFormats.slice(0, 3)) {
        if (await isStreamPlayable(best.url)) {
            return {
                format: best,
                streamUrl: best.url,
                issuer: 'direct',
            };
        }
    }

    // Check progressive format streams that are not expired
    const formatStreams = (videoData.formatStreams || []).filter((f: any) => f.url && !isFormatExpired(f.url));
    for (const best of formatStreams.slice(0, 2)) {
        if (await isStreamPlayable(best.url)) {
            return {
                format: best,
                streamUrl: best.url,
                issuer: 'direct',
            };
        }
    }

    // If direct formats are not playable directly (e.g. IP-bound or geo-restricted), proxy through /api/yt/proxy-stream
    if (adaptiveFormats.length > 0) {
        const best = adaptiveFormats[0];
        const proxyUrl = `/api/yt/proxy-stream?url=${encodeURIComponent(best.url)}`;
        return {
            format: best,
            streamUrl: proxyUrl,
            issuer: 'proxy',
        };
    }

    return null;
}

function formatResponse(
    audioFormat: any,
    streamUrl: string,
    videoData: any,
    videoId: string,
    instance: string,
    fallbackDuration?: number
) {
    const rawDuration = videoData?.lengthSeconds || fallbackDuration || 0;
    const duration = typeof rawDuration === 'number' ? rawDuration : parseInt(rawDuration) || 0;

    return {
        id: videoId,
        streamUrl,
        url: streamUrl,
        directUrl: streamUrl,
        mimeType: audioFormat.type || 'audio/webm',
        codec: audioFormat.type?.includes('opus') ? 'OPUS' : 'AAC',
        bitrate: audioFormat.bitrate || 160000,
        duration,
        title: videoData?.title || 'Unknown Title',
        author: videoData?.author || 'Unknown Artist',
        instance,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    let { id } = req.query;
    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing track ?id=' });
    }

    // Strip provider prefix if present
    const videoId = id.replace(/^yt:/, '').trim();
    if (!/^[a-zA-Z0-9_-]{5,30}$/.test(videoId)) {
        return res.status(400).json({ error: 'Invalid track ID format' });
    }

    const titleParam = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const artistParam = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
    const albumParam = typeof req.query.album === 'string' ? req.query.album.trim() : '';

    const userAgent = (req.headers['user-agent'] || '').toString();
    const isAppleDevice =
        /iPhone|iPad|iPod/i.test(userAgent) ||
        (/Macintosh/i.test(userAgent) && /Safari/i.test(userAgent) && !/Chrome|CriOS|Edg|OPR/i.test(userAgent));
    const formatParam = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : '';
    const preferM4a =
        formatParam === 'm4a' ||
        formatParam === 'mp4' ||
        formatParam === 'aac' ||
        (isAppleDevice && formatParam !== 'webm');

    let data: any = null;
    let instance: string = '';

    // Query direct companion stream and video metadata in parallel for maximum speed and resilience
    const [compResult, vidResult] = await Promise.allSettled([
        fetchCompanionDirectStream(videoId, preferM4a),
        fetchWithFailover((base) => `${base}/api/v1/videos/${videoId}`, 3000),
    ]);

    const directCompanion = compResult.status === 'fulfilled' ? compResult.value : null;
    if (vidResult.status === 'fulfilled' && vidResult.value) {
        data = vidResult.value.data;
        instance = vidResult.value.instance;
    }

    // 1. Direct companion stream fast-path (unexpired, IP-bound to companion, CORS enabled)
    if (directCompanion) {
        const rawDuration = data?.lengthSeconds || 0;
        const duration = typeof rawDuration === 'number' ? rawDuration : parseInt(rawDuration) || 0;
        return res.status(200).json({
            id: videoId,
            streamUrl: directCompanion.streamUrl,
            url: directCompanion.streamUrl,
            directUrl: directCompanion.streamUrl,
            mimeType: directCompanion.mimeType,
            codec: preferM4a ? 'AAC' : 'OPUS',
            bitrate: preferM4a ? 128000 : 160000,
            duration,
            title: titleParam || data?.title || 'Unknown Title',
            author: artistParam || data?.author || 'Unknown Artist',
            instance: directCompanion.companion,
        });
    }

    // 2. Direct Invidious Format Check: If direct companion lookup failed, check unexpired formats
    if (data) {
        const playable = await findPlayableAudio(data, preferM4a, videoId);
        if (playable) {
            return res.status(200).json(formatResponse(playable.format, playable.streamUrl, data, videoId, instance));
        }
        console.log(`[YouTube Stream] Video ${videoId} has no direct audio; starting candidate failover search`);
    }

    // 2. Candidate Search Failover: Find alternative playable uploads for this track
    const cleanArt = cleanArtist(artistParam || data?.author || '');
    const cleanTit = (titleParam || data?.title || '').trim();

    const searchQueries: string[] = [];
    if (albumParam && albumParam.toLowerCase() !== cleanTit.toLowerCase()) {
        searchQueries.push(`${albumParam} ${cleanTit} ${cleanArt}`);
        searchQueries.push(`${cleanTit} ${albumParam}`);
    }
    if (cleanTit && cleanArt) {
        searchQueries.push(`${cleanTit} ${cleanArt}`);
    }
    if (cleanTit.length <= 2 && albumParam) {
        const mainAlbum = albumParam.split(/[-:]/)[0].trim();
        searchQueries.push(`${cleanTit} ${mainAlbum}`);
    }
    if (cleanTit) {
        searchQueries.push(cleanTit);
    }
    if (cleanArt) {
        searchQueries.push(cleanArt);
    }
    if (cleanTit.length > 2 && cleanArt) {
        searchQueries.push(`${cleanTit} ${cleanArt} audio`);
    }

    for (const terms of searchQueries) {
        const cleanTerms = cleanSearchQuery(terms);
        if (!cleanTerms) continue;

        try {
            const searchRes = await fetchWithFailover(
                (base) => `${base}/api/v1/search?q=${encodeURIComponent(cleanTerms)}&type=video`,
                3000
            );
            const candidates = Array.isArray(searchRes.data)
                ? searchRes.data.filter((item: any) => {
                      const cid = item.videoId || item.id;
                      return cid && cid !== videoId;
                  })
                : [];

            if (candidates.length === 0) continue;

            const targetDuration = Number(data?.lengthSeconds) || 0;
            candidates.sort(
                (a: any, b: any) =>
                    scoreCandidate(b, cleanTit, cleanArt, targetDuration) -
                    scoreCandidate(a, cleanTit, cleanArt, targetDuration)
            );

            // Concurrently inspect top candidates and score them
            const candidateLookups = await Promise.all(
                candidates.slice(0, 6).map(async (candidate: any) => {
                    const cid = candidate.videoId || candidate.id;
                    try {
                        // Check direct companion stream first
                        const compStream = await fetchCompanionDirectStream(cid, preferM4a);
                        if (compStream) {
                            return {
                                format: { type: compStream.mimeType, bitrate: preferM4a ? 128000 : 160000 },
                                streamUrl: compStream.streamUrl,
                                data: candidate,
                                cid,
                                instance: compStream.companion,
                                score: scoreCandidate(candidate, cleanTit, cleanArt, targetDuration),
                            };
                        }
                        const cRes = await fetchWithFailover(
                            (base) => `${base}/api/v1/videos/${cid}`,
                            2500
                        );
                        const playable = await findPlayableAudio(cRes.data, preferM4a, cid);
                        if (playable) {
                            return {
                                format: playable.format,
                                streamUrl: playable.streamUrl,
                                data: cRes.data,
                                cid,
                                instance: cRes.instance,
                                score: scoreCandidate(candidate, cleanTit, cleanArt, targetDuration),
                            };
                        }
                    } catch {}
                    return null;
                })
            );

            const validCandidates = candidateLookups.filter(Boolean) as any[];
            if (validCandidates.length > 0) {
                validCandidates.sort((a, b) => b.score - a.score);
                const valid = validCandidates[0];
                console.log(
                    `[YouTube Stream] Failover matched candidate ${valid.cid} ("${valid.data?.title}") with score ${valid.score} for ${videoId}`
                );
                return res.status(200).json(
                    formatResponse(
                        valid.format,
                        valid.streamUrl,
                        valid.data,
                        valid.cid,
                        valid.instance,
                        data?.lengthSeconds
                    )
                );
            }
        } catch (searchErr) {
            console.warn(`[YouTube Stream] Failover search error for "${cleanTerms}":`, searchErr);
        }
    }

    // 3. Fallback: If no candidate was verified, check unexpired audio formats with proxy
    if (data) {
        const playable = await findPlayableAudio(data, preferM4a, videoId);
        if (playable) {
            return res.status(200).json(formatResponse(playable.format, playable.streamUrl, data, videoId, instance));
        }
    }

    return res.status(404).json({ error: 'No playable audio stream found for this track' });
}
