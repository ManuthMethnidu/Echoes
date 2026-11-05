import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../../_lib/invidious.js';

async function isStreamPlayable(url: string): Promise<boolean> {
    try {
        const testRes = await fetch(url, {
            headers: { 'Range': 'bytes=0-10' },
            signal: AbortSignal.timeout(2000),
        });
        return testRes.status === 200 || testRes.status === 206;
    } catch {
        return false;
    }
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

    if (data) {
        const adaptiveFormats = data.adaptiveFormats || [];
        const audioFormats = adaptiveFormats.filter(
            (f: any) => f.type && f.type.startsWith('audio') && f.url
        );

        if (audioFormats.length > 0) {
            audioFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
            const bestAudio = audioFormats[0];

            let streamUrl = bestAudio.url;
            if (streamUrl && instance) {
                streamUrl = streamUrl.replace(/^https:\/\/[^\/]+/, instance);
            }

            const playable = await isStreamPlayable(streamUrl);
            if (playable) {
                return res.status(200).json(formatResponse(bestAudio, streamUrl, data, videoId, instance));
            }
        } else {
            const formatStreams = (data.formatStreams || []).filter((f: any) => f.url);
            if (formatStreams.length > 0) {
                const stream = formatStreams[0];
                let streamUrl = stream.url;
                if (streamUrl && instance) {
                    streamUrl = streamUrl.replace(/^https:\/\/[^\/]+/, instance);
                }
                const playable = await isStreamPlayable(streamUrl);
                if (playable) {
                    return res.status(200).json(formatResponse(stream, streamUrl, data, videoId, instance));
                }
            }
        }
    }

    // Automatic failover for restricted, unavailable, or unplayable videos
    const queryMeta = [titleParam, artistParam].filter(Boolean).join(' ');
    const searchTerms = queryMeta || (data?.title ? `${data.title} audio` : `${videoId} audio`);

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

            for (const candidate of candidates.slice(0, 4)) {
                const cid = candidate.videoId || candidate.id;
                try {
                    const candidateVideo = await fetchWithFailover(
                        (base) => `${base}/api/v1/videos/${cid}`,
                        3000
                    );
                    const cAudioFormats = (candidateVideo.data.adaptiveFormats || []).filter(
                        (f: any) => f.type && f.type.startsWith('audio') && f.url
                    );
                    if (cAudioFormats.length > 0) {
                        cAudioFormats.sort(
                            (a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0)
                        );
                        let cStreamUrl = cAudioFormats[0].url;
                        if (cStreamUrl && candidateVideo.instance) {
                            cStreamUrl = cStreamUrl.replace(/^https:\/\/[^\/]+/, candidateVideo.instance);
                        }
                        if (await isStreamPlayable(cStreamUrl)) {
                            return res.status(200).json(
                                formatResponse(
                                    cAudioFormats[0],
                                    cStreamUrl,
                                    candidateVideo.data,
                                    cid,
                                    candidateVideo.instance
                                )
                            );
                        }
                    }
                } catch {}
            }
        } catch (searchErr) {
            console.warn('[YouTube Stream] Failover search error:', searchErr);
        }
    }

    if (data) {
        const audioFormats = (data.adaptiveFormats || []).filter(
            (f: any) => f.type && f.type.startsWith('audio') && f.url
        );
        if (audioFormats.length > 0) {
            audioFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
            const bestAudio = audioFormats[0];
            let streamUrl = bestAudio.url;
            if (streamUrl && instance) {
                streamUrl = streamUrl.replace(/^https:\/\/[^\/]+/, instance);
            }
            return res.status(200).json(formatResponse(bestAudio, streamUrl, data, videoId, instance));
        }
    }

    return res.status(404).json({ error: 'No playable audio stream found for this track' });
}
