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
    const issuer = extractIssuer(rawUrl);
    if (issuer) {
        return rawUrl.replace(/^https:\/\/[^\/]+/, `https://${issuer}`);
    }
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

async function verifyStreamPlayable(url: string, timeoutMs = 2000): Promise<boolean> {
    if (!url) return false;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
            headers: {
                'Range': 'bytes=0-100',
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

async function findVerifiedPlayableAudio(
    videoData: any,
    timeoutMs = 1800
): Promise<{ format: any; streamUrl: string; issuer: string } | null> {
    if (!videoData) return null;

    // Check adaptive formats (audio-only formats, highest bitrate first)
    const adaptiveFormats = (videoData.adaptiveFormats || []).filter(
        (f: any) => f.type && f.type.startsWith('audio') && f.url
    );
    adaptiveFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

    // Check progressive format streams
    const formatStreams = (videoData.formatStreams || []).filter((f: any) => f.url);

    const candidates: Array<{ format: any; streamUrl: string; issuer: string }> = [];

    for (const f of [...adaptiveFormats, ...formatStreams]) {
        const issuer = extractIssuer(f.url);
        if (issuer) {
            candidates.push({
                format: f,
                streamUrl: resolveStreamUrl(f.url),
                issuer,
            });
        }
    }

    if (candidates.length === 0) return null;

    // Test up to the top 2 audio formats for verified playback
    for (const c of candidates.slice(0, 2)) {
        const ok = await verifyStreamPlayable(c.streamUrl, timeoutMs);
        if (ok) return c;
    }

    return null;
}

// Early-resolving promise helper: returns the first truthy value without waiting for slow rejects/timeouts
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

    return {
        id: videoId,
        streamUrl,
        url: streamUrl,
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

    // 1. Direct Playable Check: If this video has formats signed by an active companion node, verify and return
    if (data) {
        const playable = await findVerifiedPlayableAudio(data, 1800);
        if (playable) {
            return res.status(200).json(formatResponse(playable.format, playable.streamUrl, data, videoId, instance));
        }
        console.log(`[YouTube Stream] Video ${videoId} has no verified direct stream; starting candidate failover search`);
    }

    // 2. Candidate Search Failover: Find alternative playable uploads for this track
    const cleanArt = cleanArtist(artistParam || data?.author || '');
    const cleanTit = (titleParam || data?.title || '').trim();

    const searchQueries: string[] = [];
    if (albumParam && albumParam.toLowerCase() !== cleanTit.toLowerCase()) {
        searchQueries.push(`${albumParam} ${cleanTit} ${cleanArt}`);
    }
    if (cleanTit && cleanArt) {
        searchQueries.push(`${cleanTit} ${cleanArt}`);
    } else if (cleanTit) {
        searchQueries.push(cleanTit);
    } else if (cleanArt) {
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

            // Concurrently inspect top candidates and race to return the first verified stream
            const candidateLookups = candidates.slice(0, 8).map(async (candidate: any) => {
                const cid = candidate.videoId || candidate.id;
                try {
                    const cRes = await fetchWithFailover(
                        (base) => `${base}/api/v1/videos/${cid}`,
                        2500
                    );
                    const playable = await findVerifiedPlayableAudio(cRes.data, 1800);
                    if (playable) {
                        return {
                            format: playable.format,
                            streamUrl: playable.streamUrl,
                            data: cRes.data,
                            cid,
                            instance: cRes.instance,
                        };
                    }
                } catch {}
                return null;
            });

            const valid = await findFirstValid(candidateLookups);
            if (valid) {
                console.log(`[YouTube Stream] Failover matched verified candidate ${valid.cid} for ${videoId} (${cleanTerms})`);
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
