import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithFailover } from '../../_lib/invidious.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    let { id } = req.query;
    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing track ?id=' });
    }

    // Strip provider prefix if present
    const videoId = id.replace(/^yt:/, '').trim();

    try {
        const { data, instance } = await fetchWithFailover(
            (base) => `${base}/api/v1/videos/${videoId}`
        );

        const adaptiveFormats = data.adaptiveFormats || [];
        const audioFormats = adaptiveFormats.filter(
            (f: any) => f.type && f.type.startsWith('audio') && f.url
        );

        if (audioFormats.length === 0) {
            // Check if formatStreams has audio
            const formatStreams = (data.formatStreams || []).filter((f: any) => f.url);
            if (formatStreams.length > 0) {
                const stream = formatStreams[0];
                let streamUrl = stream.url;
                if (streamUrl && instance) {
                    streamUrl = streamUrl.replace(/^https:\/\/[^\/]+/, instance);
                }
                return res.status(200).json({
                    id: videoId,
                    streamUrl,
                    url: streamUrl,
                    mimeType: stream.type || 'audio/mp4',
                    bitrate: stream.bitrate || 128000,
                    duration: data.lengthSeconds,
                    title: data.title,
                    author: data.author,
                    instance,
                });
            }
            return res.status(404).json({ error: 'No playable audio stream found for this track' });
        }

        // Sort descending by bitrate for best audio quality (ArchiveTune style: Opus 160kbps / AAC 128kbps)
        audioFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
        const bestAudio = audioFormats[0];

        let streamUrl = bestAudio.url;
        if (streamUrl && instance) {
            streamUrl = streamUrl.replace(/^https:\/\/[^\/]+/, instance);
        }

        return res.status(200).json({
            id: videoId,
            streamUrl,
            url: streamUrl,
            mimeType: bestAudio.type,
            codec: bestAudio.type?.includes('opus') ? 'OPUS' : 'AAC',
            bitrate: bestAudio.bitrate,
            duration: data.lengthSeconds,
            title: data.title,
            author: data.author,
            instance,
        });
    } catch (err: any) {
        console.error('[YouTube Stream Error]', err);
        return res.status(500).json({ error: err.message || 'Failed to resolve audio stream' });
    }
}
