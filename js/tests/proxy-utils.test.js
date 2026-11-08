import { describe, expect, test } from 'vitest';
import { getProxyUrl, isTidalAudioUrl, wrapTidalUrl } from '../proxy-utils.js';

describe('proxy-utils', () => {
    test('returns original TIDAL audio segment URLs directly without audio proxying', () => {
        const url = 'https://sp-pr-fa.audio.tidal.com/mediatracks/abc/1.mp4?token=a/b+c==';

        expect(isTidalAudioUrl(url)).toBe(false);
        expect(getProxyUrl(url)).toBe(url);
    });

    test('does not proxy non-audio TIDAL endpoints or non-TIDAL audio URLs', () => {
        expect(getProxyUrl('https://api.tidal.com/v1/tracks/1')).toBe('https://api.tidal.com/v1/tracks/1');
        expect(getProxyUrl('https://resources.tidal.com/images/cover.jpg')).toBe(
            'https://resources.tidal.com/images/cover.jpg'
        );
        expect(getProxyUrl('https://cdn.example.com/audio/1.mp4')).toBe('https://cdn.example.com/audio/1.mp4');
    });

    test('routes YouTube and Invidious audio streams through the proxy worker', () => {
        const gvUrl = 'https://rr1---sn-4g5edn6e.googlevideo.com/videoplayback?expire=123';
        expect(getProxyUrl(gvUrl)).toBe(`/api/yt/proxy-stream?url=${encodeURIComponent(gvUrl)}`);

        const invUrl = 'https://yt.chocolatemoo53.com/videoplayback?id=abc';
        expect(getProxyUrl(invUrl)).toBe(`/api/yt/proxy-stream?url=${encodeURIComponent(invUrl)}`);

        const nerdUrl = 'https://invidious.nerdvpn.de/videoplayback?id=def';
        expect(getProxyUrl(nerdUrl)).toBe(`/api/yt/proxy-stream?url=${encodeURIComponent(nerdUrl)}`);

        // Already proxied, blob or empty URLs should be returned as-is
        expect(getProxyUrl('/api/yt/proxy-stream?url=abc')).toBe('/api/yt/proxy-stream?url=abc');
        expect(getProxyUrl('blob:http://localhost/123')).toBe('blob:http://localhost/123');
        expect(getProxyUrl('')).toBe('');
    });

    test('routes TIDAL API and web requests through the proxy worker', () => {
        expect(wrapTidalUrl('https://openapi.tidal.com/v2/albums/1')).toBe(
            'https://tidal-proxy.monochrome.tf/openapi/v2/albums/1'
        );
        expect(wrapTidalUrl('https://api.tidal.com/v1/tracks/1')).toBe(
            'https://tidal-proxy.monochrome.tf/api/v1/tracks/1'
        );
        expect(wrapTidalUrl('https://tidal.com/browse/mix/1')).toBe(
            'https://tidal-proxy.monochrome.tf/tidal/browse/mix/1'
        );
    });
});
