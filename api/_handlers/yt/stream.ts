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

function cleanSearchQuery(q: string): string {
    return q
        .replace(/[^\w\s\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatResponse(audioFormat: any, streamUrl: string, videoData: any, videoId: string, instance: string) {
    return {
        id: videoId,
        streamUrl,
        url: streamUrl,
        mimeType: audioFormat.type || 'audio/webm',
        codec: audioFormat.type?.includes('opus') ? 'OPUS' : 'AAC',
        bitrate: audioFormat.bitrate || 160000,
        duration: videoData.lengthSeconds,
        title: videoData.title,
        author: videoData.author,
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

    let data: any = null;
    let instance: string = '';

    try {
        const videoRes = await fetchWithFailover(
            (base) => `${base}/api/v1/videos/${videoId}`,
            4000
        );
        data = videoRes.data;
        instance = videoRes.instance;
    } catch (directErr) {
        console.warn(`[YouTube Stream] Direct video lookup failed for ${videoId}:`, directErr);
    }

    // 1. Direct Playable Check: If this video has formats signed by an active companion node, play immediately
    if (data) {
        const playable = findPlayableAudio(data);
        if (playable) {
            return res.status(200).json(formatResponse(playable.format, playable.streamUrl, data, videoId, instance));
        }
        console.log(`[YouTube Stream] Video ${videoId} has no companion issuer; starting candidate failover search`);
    }

    // 2. Candidate Search Failover: Find alternative playable uploads for this track
    const queryParts = [artistParam || data?.author, titleParam || data?.title].filter(Boolean);
    const baseQuery = queryParts.length > 0 ? queryParts.join(' ') : (data?.title || videoId);
    const searchTerms = cleanSearchQuery(`${baseQuery} audio`) || cleanSearchQuery(baseQuery) || `${videoId} audio`;

    if (searchTerms) {
        try {
            const searchRes = await fetchWithFailover(
                (base) => `${base}/api/v1/search?q=${encodeURIComponent(searchTerms)}&type=video`,
                3500
            );
            const candidates = Array.isArray(searchRes.data)
                ? searchRes.data.filter((item: any) => {
                      const cid = item.videoId || item.id;
                      return cid && cid !== videoId;
                  })
                : [];

            // Concurrently inspect top 10 candidates to pick the first one with an active companion issuer
            const candidateLookups = candidates.slice(0, 10).map(async (candidate: any) => {
                const cid = candidate.videoId || candidate.id;
                try {
                    const cRes = await fetchWithFailover(
                        (base) => `${base}/api/v1/videos/${cid}`,
                        3000
                    );
                    const playable = findPlayableAudio(cRes.data);
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

            const candidateResults = await Promise.all(candidateLookups);
            const valid = candidateResults.find(Boolean);
            if (valid) {
                console.log(`[YouTube Stream] Failover matched candidate ${valid.cid} for ${videoId} (${searchTerms})`);
                return res.status(200).json(
                    formatResponse(valid.format, valid.streamUrl, valid.data, valid.cid, valid.instance)
                );
            }
        } catch (searchErr) {
            console.warn('[YouTube Stream] Failover search error:', searchErr);
        }
    }

    // 3. Fallback: If no candidate had an issuer, but the direct video had audio formats, provide best format
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
