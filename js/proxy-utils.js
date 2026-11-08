export const isTidalAudioUrl = () => false;

/** Domains whose audio URLs must be fetched server-side to avoid CORS / expiry issues */
const PROXY_DOMAINS = [
    'googlevideo.com',
    'youtube.com',
    'chocolatemoo53.com',
    'yt.chocolatemoo53.com',
    'nerdvpn.de',
    'nadeko.net',
    'materialio.us',
    'protokolla.fi',
    'ducks.party',
    'invidious.io',
    'snopyta.org',
    'drgns.space',
    'privacydev.net',
    'lunar.icu',
    'perennialte.ch',
    'adminforge.de',
    'projectsegfau.lt',
];

function needsProxy(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/api/')) return false;
    try {
        const { hostname } = new URL(url);
        return PROXY_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
    } catch {
        return false;
    }
}

export const getProxyUrl = (url) => {
    if (!url) return url;
    if (!needsProxy(url)) return url;
    return `/api/yt/proxy-stream?url=${encodeURIComponent(url)}`;
};

export const wrapTidalUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    return url
        .replace('openapi.tidal.com', 'tidal-proxy.monochrome.tf/openapi')
        .replace('api.tidal.com', 'tidal-proxy.monochrome.tf/api')
        .replace('https://tidal.com', 'https://tidal-proxy.monochrome.tf/tidal');
};
