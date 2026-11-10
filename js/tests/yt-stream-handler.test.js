import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockHttpsRequest, mockFetchWithFailover } = vi.hoisted(() => ({
    mockHttpsRequest: vi.fn(),
    mockFetchWithFailover: vi.fn(),
}));

vi.mock('https', () => ({
    default: {
        request: mockHttpsRequest,
    },
}));

vi.mock('../../api/_lib/invidious.js', () => ({
    fetchWithFailover: mockFetchWithFailover,
    isFormatExpired: () => false,
}));

import streamHandler from '../../api/_handlers/yt/stream.js';

function createMockResponse() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(data) {
            res.body = data;
            return res;
        },
    };
    return res;
}

describe('api/_handlers/yt/stream.ts', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.fetch = originalFetch;
        mockHttpsRequest.mockImplementation((_opts, _cb) => {
            const handlers = new Map();
            const req = {
                on(ev, fn) {
                    handlers.set(ev, fn);
                    return req;
                },
                destroy() {},
                end() {
                    queueMicrotask(() => {
                        const errFn = handlers.get('error');
                        if (errFn) errFn(new Error('companion disabled'));
                    });
                },
            };
            return req;
        });
    });

    test('rewrites googlevideo URLs to yt-comp* and routes through VPS proxy when reachable and playable', async () => {
        const rawGoogleUrl =
            'https://rr3---sn-test.googlevideo.com/videoplayback?expire=9999999999&itag=251&ip=2602::1&issuer=yt-comp3.chocolatemoo53.com';

        mockFetchWithFailover.mockImplementation(async (urlBuilder) => {
            const built = urlBuilder('https://yt.chocolatemoo53.com');
            if (built.includes('/api/v1/videos/')) {
                return {
                    instance: 'https://yt.chocolatemoo53.com',
                    data: {
                        videoId: 'yvMkIxgeCpA',
                        title: 'Test Track',
                        author: 'Test Artist',
                        lengthSeconds: 180,
                        adaptiveFormats: [
                            { type: 'audio/webm; codecs="opus"', bitrate: '139182', url: rawGoogleUrl },
                        ],
                    },
                };
            }
            return { instance: 'https://yt.chocolatemoo53.com', data: [] };
        });

        const fetchedUrls = [];
        globalThis.fetch = vi.fn(async (url) => {
            fetchedUrls.push(String(url));
            if (String(url).startsWith('https://stream.mteck.tech/stream?url=')) {
                return new Response(new Uint8Array([1, 2, 3]), { status: 206 });
            }
            return new Response('Forbidden', { status: 403 });
        });

        const res = createMockResponse();
        await streamHandler(
            { query: { id: 'yt:yvMkIxgeCpA' }, headers: { 'user-agent': 'Mozilla/5.0 Chrome/131.0.0.0' } },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.streamUrl).toMatch(/^https:\/\/stream\.mteck\.tech\/stream\?url=/);

        const wrappedUrl = new URL(decodeURIComponent(res.body.streamUrl.split('?url=')[1]));
        expect(wrappedUrl.hostname).toBe('yt-comp3.chocolatemoo53.com');
        expect(wrappedUrl.searchParams.get('host')).toBe('rr3---sn-test.googlevideo.com');
        expect(wrappedUrl.searchParams.has('issuer')).toBe(false);
        expect(fetchedUrls.some((u) => u.startsWith('https://stream.mteck.tech/stream?url='))).toBe(true);
    });

    test('falls back to /api/yt/proxy-stream only when VPS proxy is unreachable and companion probe passes', async () => {
        const rawGoogleUrl =
            'https://rr3---sn-test.googlevideo.com/videoplayback?expire=9999999999&itag=251&ip=2602::1&issuer=yt-comp2.chocolatemoo53.com';

        mockFetchWithFailover.mockImplementation(async (urlBuilder) => {
            const built = urlBuilder('https://yt.chocolatemoo53.com');
            if (built.includes('/api/v1/videos/')) {
                return {
                    instance: 'https://yt.chocolatemoo53.com',
                    data: {
                        videoId: 'yvMkIxgeCpA',
                        title: 'Test Track',
                        author: 'Test Artist',
                        lengthSeconds: 180,
                        adaptiveFormats: [
                            { type: 'audio/webm; codecs="opus"', bitrate: '139182', url: rawGoogleUrl },
                        ],
                    },
                };
            }
            return { instance: 'https://yt.chocolatemoo53.com', data: [] };
        });

        globalThis.fetch = vi.fn(async (url, init = {}) => {
            const u = String(url);
            if (u.startsWith('https://stream.mteck.tech/stream?url=')) {
                throw new Error('ECONNREFUSED');
            }
            if (u.startsWith('https://yt-comp2.chocolatemoo53.com/videoplayback')) {
                expect(init.headers?.Referer).toBe('https://yt.chocolatemoo53.com/');
                return new Response(new Uint8Array([1, 2, 3]), { status: 206 });
            }
            return new Response('Forbidden', { status: 403 });
        });

        const res = createMockResponse();
        await streamHandler(
            { query: { id: 'yt:yvMkIxgeCpA' }, headers: { 'user-agent': 'Mozilla/5.0 Chrome/131.0.0.0' } },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.streamUrl).toMatch(/^\/api\/yt\/proxy-stream\?url=/);
        const wrappedUrl = new URL(decodeURIComponent(res.body.streamUrl.split('?url=')[1]));
        expect(wrappedUrl.hostname).toBe('yt-comp2.chocolatemoo53.com');
        expect(wrappedUrl.searchParams.get('host')).toBe('rr3---sn-test.googlevideo.com');
    });

    test('returns 404 when VPS proxy responds 403 instead of emitting unverified proxy URLs', async () => {
        const rawGoogleUrl =
            'https://rr3---sn-test.googlevideo.com/videoplayback?expire=9999999999&itag=251&ip=2602::1';

        mockFetchWithFailover.mockImplementation(async (urlBuilder) => {
            const built = urlBuilder('https://yt.chocolatemoo53.com');
            if (built.includes('/api/v1/videos/')) {
                return {
                    instance: 'https://yt.chocolatemoo53.com',
                    data: {
                        videoId: 'yvMkIxgeCpA',
                        title: 'Test Track',
                        author: 'Test Artist',
                        lengthSeconds: 180,
                        adaptiveFormats: [
                            { type: 'audio/webm; codecs="opus"', bitrate: '139182', url: rawGoogleUrl },
                        ],
                    },
                };
            }
            return { instance: 'https://yt.chocolatemoo53.com', data: [] };
        });

        globalThis.fetch = vi.fn(async () => new Response('Forbidden', { status: 403 }));

        const res = createMockResponse();
        await streamHandler(
            { query: { id: 'yt:yvMkIxgeCpA' }, headers: { 'user-agent': 'Mozilla/5.0 Chrome/131.0.0.0' } },
            res
        );

        expect(res.statusCode).toBe(404);
    });
});
