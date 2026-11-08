// In-memory LRU-like cache for video info and search results
const cache = new Map<string, { data: any; instance: string; timestamp: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 mins

const ORDERED_INSTANCES = [
    'https://yt.chocolatemoo53.com',
];

export function isFormatExpired(url: string, bufferSeconds = 60): boolean {
    if (!url) return true;
    try {
        const u = new URL(url);
        const expStr = u.searchParams.get('expire');
        if (expStr) {
            const exp = parseInt(expStr, 10);
            if (!isNaN(exp) && exp <= Math.floor(Date.now() / 1000) + bufferSeconds) {
                return true;
            }
        }
    } catch {}
    return false;
}

function hasExpiredAudio(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    const af = data.adaptiveFormats?.filter((f: any) => f.type && f.type.startsWith('audio') && f.url);
    if (!af || af.length === 0) return false;
    return af.every((f: any) => isFormatExpired(f.url, 60));
}

export async function fetchWithFailover(
    pathBuilder: (base: string) => string,
    timeoutMs = 5000
): Promise<{ data: any; instance: string }> {
    const sampleKey = pathBuilder('');
    
    // Check in-memory cache
    const cached = cache.get(sampleKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        if (!hasExpiredAudio(cached.data)) {
            return { data: cached.data, instance: cached.instance };
        }
        cache.delete(sampleKey);
    }

    const abortControllers: AbortController[] = [];

    const fetchInstance = async (base: string): Promise<{ data: any; instance: string }> => {
        const controller = new AbortController();
        abortControllers.push(controller);
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const url = pathBuilder(base);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status} from ${base}`);
            }

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('json')) {
                throw new Error(`Non-JSON (${contentType}) from ${base}`);
            }

            const data = await res.json();
            if (data && typeof data === 'object' && data.error) {
                throw new Error(`Invidious error from ${base}: ${data.error}`);
            }

            return { data, instance: base };
        } finally {
            clearTimeout(timer);
        }
    };

    try {
        const result = await Promise.any(
            ORDERED_INSTANCES.map((base) => fetchInstance(base))
        );

        // Abort in-flight requests once fastest succeeds
        abortControllers.forEach((ac) => {
            try { ac.abort(); } catch {}
        });

        // Cache successful response
        cache.set(sampleKey, { data: result.data, instance: result.instance, timestamp: Date.now() });
        if (cache.size > 200) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
        }

        return result;
    } catch (aggregateErr: any) {
        abortControllers.forEach((ac) => {
            try { ac.abort(); } catch {}
        });
        const firstErr = aggregateErr?.errors?.[0]?.message || aggregateErr?.message || 'timeout';
        throw new Error(`All audio streaming instances failed: ${firstErr}`);
    }
}
