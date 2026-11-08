import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const videoId = '6r5Fsq7cK9w';
    const body = {
        context: {
            client: {
                clientName: 'ANDROID',
                clientVersion: '20.10.38',
                androidSdkVersion: 34
            }
        },
        videoId: videoId
    };
    try {
        const ytRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'
            },
            body: JSON.stringify(body)
        });
        const json = await ytRes.json();
        const formats = json.streamingData?.adaptiveFormats || [];
        const audio = formats.filter((f: any) => f.mimeType && f.mimeType.startsWith('audio'));
        return res.status(200).json({
            status: json.playabilityStatus?.status,
            reason: json.playabilityStatus?.reason,
            audioFormatsCount: audio.length,
            hasUrls: audio.some((f: any) => !!f.url)
        });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
}
