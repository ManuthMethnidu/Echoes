import type { VercelRequest, VercelResponse } from '@vercel/node';

interface CaptionCue {
    startMs: number;
    durMs: number;
    text: string;
}

interface AvailableLanguage {
    code: string;
    name: string;
    kind?: string;
    vssId?: string;
}

const ANDROID_USER_AGENT = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip';

const ANDROID_CLIENT_CONTEXT = {
    client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 34,
    },
};

/**
 * Decode HTML entities in text
 */
function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Clean subtitle text
 */
function cleanSubtitleText(raw: string): string {
    return decodeHtmlEntities(raw.replace(/<[^>]+>/g, ''))
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width spaces
        .replace(/\r\n|\r/g, '\n')
        .trim();
}

/**
 * Format milliseconds into standard LRC timestamp [mm:ss.xx]
 */
function formatLrcTimestamp(ms: number): string {
    const totalSec = Math.max(0, ms) / 1000;
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    const cs = Math.floor((ms % 1000) / 10);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `[${pad(m)}:${pad(s)}.${pad(cs)}]`;
}

/**
 * Format milliseconds into TTML time 00:00:00.000
 */
function formatTtmlTime(ms: number): string {
    const totalSec = Math.max(0, ms) / 1000;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    const frac = String(ms % 1000).padStart(3, '0');
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${frac}`;
}

/**
 * Translate an array of non-empty strings into target language using Google's translate engine
 */
export async function translateTexts(
    texts: string[],
    targetLang: string,
    sourceLang = 'auto'
): Promise<{ translated: string[]; detectedSource: string }> {
    if (!texts.length || !targetLang) {
        return { translated: texts, detectedSource: sourceLang };
    }

    const BATCH_SIZE = 40;
    const allTranslated: string[] = [];
    let detectedSource = sourceLang;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const joined = batch.join('\n');

        try {
            const body = new URLSearchParams({
                client: 'gtx',
                sl: sourceLang,
                tl: targetLang,
                dt: 't',
                q: joined,
            });

            const res = await fetch('https://translate.googleapis.com/translate_a/single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });

            if (!res.ok) {
                allTranslated.push(...batch);
                continue;
            }

            const data = await res.json();
            if (data[2] && detectedSource === 'auto') {
                detectedSource = data[2];
            }

            const fullText = (data[0] || []).map((item: any) => item[0] || '').join('');
            const splitLines = fullText.split('\n');

            if (splitLines.length === batch.length) {
                for (let j = 0; j < batch.length; j++) {
                    allTranslated.push(splitLines[j].trim() || batch[j]);
                }
            } else {
                // Fallback: translate individually
                const fallbackPromises = batch.map(async (line) => {
                    try {
                        const sBody = new URLSearchParams({
                            client: 'gtx',
                            sl: sourceLang,
                            tl: targetLang,
                            dt: 't',
                            q: line,
                        });
                        const sRes = await fetch('https://translate.googleapis.com/translate_a/single', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: sBody.toString(),
                        });
                        if (sRes.ok) {
                            const sData = await sRes.json();
                            return (sData[0] || []).map((x: any) => x[0] || '').join('').trim() || line;
                        }
                    } catch {}
                    return line;
                });
                const resolved = await Promise.all(fallbackPromises);
                allTranslated.push(...resolved);
            }
        } catch {
            allTranslated.push(...batch);
        }
    }

    return { translated: allTranslated, detectedSource };
}

/**
 * Fetch video player data from InnerTube
 */
async function fetchInnerTubePlayer(videoId: string): Promise<any> {
    try {
        const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': ANDROID_USER_AGENT,
            },
            body: JSON.stringify({
                context: ANDROID_CLIENT_CONTEXT,
                videoId,
            }),
        });
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.warn(`[InnerTube Player Error for ${videoId}]`, e);
    }
    return null;
}

/**
 * Search YouTube for candidate video IDs
 */
async function searchYouTubeCandidates(title: string, artist: string): Promise<string[]> {
    const videoIds: string[] = [];
    const queries = [
        `${artist} ${title} lyrics`.trim(),
        `${artist} ${title} official`.trim(),
        `${title} ${artist}`.trim(),
    ];

    for (const query of queries) {
        if (videoIds.length >= 8) break;
        try {
            const searchRes = await fetch('https://www.youtube.com/youtubei/v1/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': ANDROID_USER_AGENT,
                },
                body: JSON.stringify({
                    context: ANDROID_CLIENT_CONTEXT,
                    query,
                }),
            });

            if (searchRes.ok) {
                const sData = await searchRes.json();
                const sections = sData.contents?.sectionListRenderer?.contents || [];
                for (const section of sections) {
                    const contents = section.itemSectionRenderer?.contents || [];
                    for (const item of contents) {
                        const vr = item.videoRenderer || item.compactVideoRenderer;
                        if (vr?.videoId && !videoIds.includes(vr.videoId)) {
                            videoIds.push(vr.videoId);
                        }
                    }
                }
            }
        } catch (sErr) {
            console.warn('[InnerTube Search Error]', sErr);
        }
    }

    return videoIds;
}

/**
 * Parse caption cues from YouTube XML timedtext
 */
function parseCaptionXml(xml: string): CaptionCue[] {
    const cues: CaptionCue[] = [];

    // Format 3: <p t="1960" d="3560">...</p>
    const pRegex = /<p t="(\d+)"(?: d="(\d+)")?[^>]*>(.*?)<\/p>/g;
    let match: RegExpExecArray | null;

    while ((match = pRegex.exec(xml)) !== null) {
        const startMs = parseInt(match[1], 10);
        const durMs = parseInt(match[2] || '3000', 10);
        const text = cleanSubtitleText(match[3]);
        if (text) {
            cues.push({ startMs, durMs, text });
        }
    }

    // Format 1 fallback: <text start="1.96" dur="3.56">...</text>
    if (cues.length === 0) {
        const textRegex = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>(.*?)<\/text>/g;
        while ((match = textRegex.exec(xml)) !== null) {
            const startMs = Math.round(parseFloat(match[1]) * 1000);
            const durMs = Math.round(parseFloat(match[2] || '3') * 1000);
            const text = cleanSubtitleText(match[3]);
            if (text) {
                cues.push({ startMs, durMs, text });
            }
        }
    }

    return cues;
}

/**
 * Generate Apple Music / W3C compliant TTML
 */
function buildTtml(
    originalCues: CaptionCue[],
    translatedTexts: string[] | null,
    title: string,
    artist: string,
    sourceLang: string,
    targetLang?: string
): string {
    const hasTranslation = Boolean(translatedTexts && translatedTexts.length === originalCues.length && targetLang);

    let ttml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    ttml += `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyrics" xml:lang="${sourceLang || 'en'}">\n`;
    ttml += '  <head>\n    <metadata>\n';
    ttml += `      <ttm:title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</ttm:title>\n`;
    if (artist) {
        ttml += `      <ttm:copyright>${artist.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</ttm:copyright>\n`;
    }

    if (hasTranslation && translatedTexts) {
        ttml += `      <translation xml:lang="${targetLang}">\n`;
        for (let i = 0; i < translatedTexts.length; i++) {
            const escaped = translatedTexts[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            ttml += `        <text for="cue_${i}">${escaped}</text>\n`;
        }
        ttml += '      </translation>\n';
    }

    ttml += '    </metadata>\n  </head>\n  <body>\n    <div>\n';

    for (let i = 0; i < originalCues.length; i++) {
        const cue = originalCues[i];
        const beginTime = formatTtmlTime(cue.startMs);
        const endTime = formatTtmlTime(cue.startMs + Math.max(1000, cue.durMs));
        const escaped = cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        ttml += `      <p itunes:key="cue_${i}" begin="${beginTime}" end="${endTime}"><span>${escaped}</span></p>\n`;
    }

    ttml += '    </div>\n  </body>\n</tt>';
    return ttml;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Direct Translation endpoint support via POST
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
            const text = (body.text || body.lrc || '').trim();
            const targetLang = (body.tlang || body.targetLang || 'en').trim();
            const sourceLang = (body.sl || body.sourceLang || 'auto').trim();

            if (!text) {
                return res.status(400).json({ error: 'Missing text or lrc to translate' });
            }

            // Translate LRC line by line preserving timestamps
            const lines = text.split('\n');
            const parsedLines: Array<{ prefix: string; text: string }> = [];
            const textsToTranslate: string[] = [];

            for (const line of lines) {
                const match = line.match(/^(\[\d+:\d+(?:\.\d+)?\])\s*(.*)$/);
                if (match) {
                    parsedLines.push({ prefix: match[1], text: match[2].trim() });
                    if (match[2].trim()) textsToTranslate.push(match[2].trim());
                } else if (line.trim()) {
                    parsedLines.push({ prefix: '', text: line.trim() });
                    textsToTranslate.push(line.trim());
                } else {
                    parsedLines.push({ prefix: '', text: '' });
                }
            }

            const { translated, detectedSource } = await translateTexts(textsToTranslate, targetLang, sourceLang);
            const transMap = new Map<string, string>();
            for (let i = 0; i < textsToTranslate.length; i++) {
                transMap.set(textsToTranslate[i], translated[i] || textsToTranslate[i]);
            }

            const translatedLines = parsedLines.map((p) => {
                if (!p.text) return p.prefix;
                const tr = transMap.get(p.text) || p.text;
                return p.prefix ? `${p.prefix} ${tr}` : tr;
            });

            return res.status(200).json({
                translated: translatedLines.join('\n'),
                sourceLanguage: detectedSource,
                targetLanguage: targetLang,
            });
        } catch (err: any) {
            console.error('[Translation POST Error]', err);
            return res.status(500).json({ error: err.message || 'Translation failed' });
        }
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    let videoId = (typeof req.query.id === 'string' ? req.query.id : '').replace(/^yt:/, '').trim();
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
    const preferredLang = typeof req.query.lang === 'string' ? req.query.lang.trim().toLowerCase() : '';
    const targetLang = typeof req.query.tlang === 'string' ? req.query.tlang.trim().toLowerCase() : '';

    let candidateVideoIds: string[] = [];
    if (videoId) {
        candidateVideoIds.push(videoId);
    }
    if (title || artist) {
        const found = await searchYouTubeCandidates(title, artist);
        for (const f of found) {
            if (!candidateVideoIds.includes(f)) {
                candidateVideoIds.push(f);
            }
        }
    }

    if (!candidateVideoIds.length) {
        return res.status(400).json({ error: 'Missing ?id= or title/artist parameters' });
    }

    try {
        let matchedVideoId = '';
        let captionTracks: any[] = [];

        // Check top candidate videos for caption tracks
        for (const vId of candidateVideoIds.slice(0, 5)) {
            const playerData = await fetchInnerTubePlayer(vId);
            const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            if (tracks.length > 0) {
                matchedVideoId = vId;
                captionTracks = tracks;
                break;
            }
        }

        if (!captionTracks.length) {
            return res.status(404).json({ error: 'No captions found for this track on YouTube' });
        }

        // Map available languages
        const availableLanguages: AvailableLanguage[] = captionTracks.map((t: any) => ({
            code: t.languageCode || '',
            name: t.name?.runs?.[0]?.text || t.languageCode || '',
            kind: t.kind || 'standard',
            vssId: t.vssId,
        }));

        // Select the best caption track:
        let selectedTrack = null;

        // 1. If preferred language matches directly
        if (preferredLang) {
            selectedTrack = captionTracks.find(
                (t: any) => t.languageCode?.toLowerCase() === preferredLang || t.languageCode?.toLowerCase().startsWith(`${preferredLang}-`)
            );
        }

        // 2. If target translation language matches a native track directly (no translation needed!)
        if (!selectedTrack && targetLang) {
            selectedTrack = captionTracks.find(
                (t: any) => t.languageCode?.toLowerCase() === targetLang || t.languageCode?.toLowerCase().startsWith(`${targetLang}-`)
            );
        }

        // 3. Prefer English track as source if available (most reliable base for translation)
        if (!selectedTrack) {
            selectedTrack =
                captionTracks.find((t: any) => t.languageCode?.toLowerCase().startsWith('en') && t.kind !== 'asr') ||
                captionTracks.find((t: any) => t.languageCode?.toLowerCase().startsWith('en')) ||
                captionTracks.find((t: any) => t.kind !== 'asr') ||
                captionTracks[0];
        }

        // Fetch caption XML from track baseUrl
        const captionRes = await fetch(selectedTrack.baseUrl, {
            headers: {
                'User-Agent': ANDROID_USER_AGENT,
            },
        });

        if (!captionRes.ok) {
            return res.status(502).json({ error: 'Failed to retrieve caption stream from YouTube' });
        }

        const captionXml = await captionRes.text();
        const cues = parseCaptionXml(captionXml);

        if (!cues.length) {
            return res.status(404).json({ error: 'No timed lyrics cues could be parsed from captions' });
        }

        const sourceLang = selectedTrack.languageCode || 'en';
        const needsTranslation = Boolean(targetLang && targetLang !== sourceLang && !targetLang.startsWith(sourceLang));

        let translatedTexts: string[] | null = null;
        let detectedSource = sourceLang;

        if (needsTranslation) {
            const rawTexts = cues.map((c) => c.text);
            const transResult = await translateTexts(rawTexts, targetLang, sourceLang);
            translatedTexts = transResult.translated;
            detectedSource = transResult.detectedSource;
        }

        // Build LRC lines
        const originalLrcLines: string[] = [];
        const originalPlainLines: string[] = [];
        const activeLrcLines: string[] = [];
        const activePlainLines: string[] = [];

        for (let i = 0; i < cues.length; i++) {
            const cue = cues[i];
            const ts = formatLrcTimestamp(cue.startMs);
            const origText = cue.text;
            const transText = translatedTexts ? translatedTexts[i] || origText : origText;

            originalLrcLines.push(`${ts} ${origText}`);
            originalPlainLines.push(origText);

            activeLrcLines.push(`${ts} ${transText}`);
            activePlainLines.push(transText);
        }

        const trackTitle = title || 'Unknown Title';
        const trackArtist = artist || '';
        const ttml = buildTtml(
            cues,
            translatedTexts,
            trackTitle,
            trackArtist,
            detectedSource,
            needsTranslation ? targetLang : undefined
        );

        const providerLabel = needsTranslation
            ? `YouTube Captions (Translated to ${targetLang.toUpperCase()})`
            : `YouTube Captions (${selectedTrack.name?.runs?.[0]?.text || sourceLang.toUpperCase()})`;

        return res.status(200).json({
            syncedLyrics: activeLrcLines.join('\n'),
            plainLyrics: activePlainLines.join('\n'),
            originalSyncedLyrics: originalLrcLines.join('\n'),
            originalPlainLyrics: originalPlainLines.join('\n'),
            sourceLanguage: detectedSource,
            targetLanguage: needsTranslation ? targetLang : sourceLang,
            isTranslated: needsTranslation,
            availableLanguages,
            lyricsProvider: providerLabel,
            source: `YouTube Closed Captions (${matchedVideoId})`,
            videoId: matchedVideoId,
            ttml,
        });
    } catch (err: any) {
        console.error('[YT Captions Handler Error]', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
