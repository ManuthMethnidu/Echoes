import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../../_lib/invidious.js';

function extractIssuer(rawUrl: string): string | null {
    if (!rawUrl) return null;
    try {
        const parsed = new URL(rawUrl);
        const issuer = parsed.searchParams.get('issuer');
        if (issuer && issuer.trim().length > 3) {
            return issuer.trim();
        }
    } catch {}
    return null;
}

function resolveStreamUrl(rawUrl: string, instance?: string): string {
    if (!rawUrl) return rawUrl;
    try {
        const parsed = new URL(rawUrl);
        const issuer = extractIssuer(rawUrl);
        if (issuer) {
            let origHost = parsed.hostname;
            if (!origHost.includes('googlevideo.com')) {
                const mvi = parsed.searchParams.get('mvi') || '1';
                const mn = parsed.searchParams.get('mn')?.split(',')[0];
                if (mn) {
                    origHost = `rr${mvi}---${mn}.googlevideo.com`;
                }
            }
            parsed.searchParams.set('host', origHost);
            return `https://${issuer}${parsed.pathname}${parsed.search}`;
        }
    } catch {}
    if (instance) {
        return rawUrl.replace(/^https:\/\/[^\/]+/, instance);
    }
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

function findPlayableAudio(videoData: any): { format: any; streamUrl: string; issuer: string } | null {
    if (!videoData) return null;

    // Check adaptive formats (audio-only formats, highest bitrate first)
    const adaptiveFormats = (videoData.adaptiveFormats || []).filter(
        (f: any) => f.type && f.type.startsWith('audio') && f.url
    );
    adaptiveFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

    for (const f of adaptiveFormats) {
        const issuer = extractIssuer(f.url);
        if (issuer) {
            return {
                format: f,
                streamUrl: resolveStreamUrl(f.url),
                issuer,
            };
        }
    }

    // Check progressive format streams
    const formatStreams = (videoData.formatStreams || []).filter((f: any) => f.url);
    for (const f of formatStreams) {
        const issuer = extractIssuer(f.url);
        if (issuer) {
            return {
                format: f,
                streamUrl: resolveStreamUrl(f.url),
                issuer,
            };
        }
    }

    return null;
}

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

    // Route through our CORS-enabled Vercel proxy stream to guarantee seamless browser playback and Web Audio compatibility
    const proxyUrl = `/api/yt/proxy-stream?url=${encodeURIComponent(streamUrl)}`;

    return {
        id: videoId,
        streamUrl: proxyUrl,
        url: proxyUrl,
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

    let data: any = null;
    let instance: string = '';

    try {
        const videoRes = await fetchWithFailover(
            (base) => `${base}/api/v1/videos/${videoId}`,
            3500
        );
        data = videoRes.data;
        instance = videoRes.instance;
    } catch (directErr) {
        console.warn(`[YouTube Stream] Direct video lookup failed for ${videoId}:`, directErr);
    }

    // 1. Direct Playable Check: If this video has formats signed by an active companion node, return immediately
    if (data) {
        const playable = findPlayableAudio(data);
        if (playable) {
            return res.status(200).json(formatResponse(playable.format, playable.streamUrl, data, videoId, instance));
        }
        console.log(`[YouTube Stream] Video ${videoId} has no companion issuer; starting candidate failover search`);
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
                        const cRes = await fetchWithFailover(
                            (base) => `${base}/api/v1/videos/${cid}`,
                            2500
                        );
                        const playable = findPlayableAudio(cRes.data);
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

    // 3. Fallback: If no candidate had an active companion issuer, but direct video had audio formats, provide best format
    if (data) {
        const audioFormats = (data.adaptiveFormats || []).filter(
            (f: any) => f.type && f.type.startsWith('audio') && f.url
        );
        if (audioFormats.length > 0) {
            audioFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
            const bestAudio = audioFormats[0];
            const streamUrl = resolveStreamUrl(bestAudio.url, instance);
            return res.status(200).json(formatResponse(bestAudio, streamUrl, data, videoId, instance));
        }
    }

    return res.status(404).json({ error: 'No playable audio stream found for this track' });
}
