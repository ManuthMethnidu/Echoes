// In-memory LRU-like cache for video info and search results
const cache = new Map<string, { data: any; instance: string; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const ORDERED_INSTANCES = [
    'https://yt.chocolatemoo53.com',
    'https://invidious.materialio.us',
    'https://invidious.protokolla.fi',
    'https://invidious.ducks.party',
];

export async function fetchWithFailover(
    pathBuilder: (base: string) => string,
    timeoutMs = 8000
): Promise<{ data: any; instance: string }> {
    const sampleKey = pathBuilder('');
    
    // Check in-memory cache
    const cached = cache.get(sampleKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return { data: cached.data, instance: cached.instance };
    }

    let lastError: any = null;

    for (const base of ORDERED_INSTANCES) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const url = pathBuilder(base);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
            });

            clearTimeout(timer);

            if (!res.ok) {
                lastError = new Error(`HTTP ${res.status} from ${base}`);
                continue;
            }

            const data = await res.json();
            
            // Cache successful response
            cache.set(sampleKey, { data, instance: base, timestamp: Date.now() });
            if (cache.size > 200) {
                const oldest = cache.keys().next().value;
                if (oldest) cache.delete(oldest);
            }

            return { data, instance: base };
        } catch (err: any) {
            lastError = err;
        }
    }

    throw new Error(`All audio streaming instances failed: ${lastError?.message || 'timeout'}`);
}
