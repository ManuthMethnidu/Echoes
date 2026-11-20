import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api.js', () => {
    return {
        LosslessAPI: class {
            searchTracks = vi.fn().mockResolvedValue({ items: [] });
            searchVideos = vi.fn().mockResolvedValue({ items: [] });
            searchArtists = vi.fn().mockResolvedValue({ items: [] });
            searchAlbums = vi.fn().mockResolvedValue({ items: [] });
            searchPlaylists = vi.fn().mockResolvedValue({ items: [] });
            getStreamUrl = vi.fn().mockRejectedValue(new Error('Tidal stream not available'));
            getAlbum = vi.fn().mockResolvedValue({ album: {}, tracks: [] });
            getArtist = vi.fn().mockResolvedValue({ name: 'Artist' });
            clearCache = vi.fn().mockResolvedValue();
        },
    };
});

const mockResolveStream = vi.fn();
const mockYtSearch = vi.fn();

vi.mock('../yt-music.js', () => ({
    ytEngine: {
        search: (...args) => mockYtSearch(...args),
        resolveStream: (...args) => mockResolveStream(...args),
    },
}));

if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => store.get(k) || null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    };
}

import { MusicAPI } from '../music-api.js';

describe('MusicAPI Stream Diagnostics and Failover Telemetry', () => {
    let api;

    beforeEach(() => {
        vi.clearAllMocks();
        api = new MusicAPI({
            apiBaseUrl: 'https://api.tidal.com',
            apiToken: 'mock-token',
        });
    });

    it('forces Monochrome provider when forceProvider is monochrome', async () => {
        api.tracksStreamerAPI.resolveTrackStream = vi.fn().mockResolvedValue({
            url: 'https://tracks.monochrome.st/stream/flac/12345',
            codec: 'FLAC',
            bitrateKbps: 1411,
            lossless: true,
            sampleRateHz: 44100,
            bitDepth: 16,
        });

        const track = { id: 'track-1', title: 'Test Song', artist: { name: 'Test Artist' } };
        const result = await api.getStreamUrl(track.id, 'LOSSLESS', {
            track,
            forceProvider: 'monochrome',
        });

        expect(api.tracksStreamerAPI.resolveTrackStream).toHaveBeenCalledWith('track-1', 'LOSSLESS', {
            track,
            forceProvider: 'monochrome',
        });
        expect(result.url).toBe('https://tracks.monochrome.st/stream/flac/12345');
        expect(result.provider).toBe('monochrome');
        expect(result.lossless).toBe(true);
    });

    it('forces YouTube provider when forceProvider is youtube', async () => {
        mockYtSearch.mockResolvedValue([
            { id: 'yt:abc12345678', videoId: 'abc12345678', title: 'Test Song' },
        ]);
        mockResolveStream.mockResolvedValue({
            streamUrl: 'https://stream.mteck.tech/yt/abc12345678?format=m4a',
            codec: 'AAC',
            bitrate: 130000,
        });

        const track = { id: 'track-1', title: 'Test Song', artist: { name: 'Test Artist' } };
        const result = await api.getStreamUrl(track.id, 'LOSSLESS', {
            track,
            forceProvider: 'youtube',
        });

        expect(result.url).toBe('https://stream.mteck.tech/yt/abc12345678?format=m4a');
        expect(result.provider).toBe('youtube');
        expect(result.lossless).toBe(false);
    });

    it('tags isFallback: true and records failover when Monochrome fails and falls back to YouTube', async () => {
        // Monochrome fails with 429
        api.tracksStreamerAPI.resolveTrackStream = vi.fn().mockRejectedValue(new Error('HTTP 429: Rate limited'));

        mockYtSearch.mockResolvedValue([
            { id: 'yt:fallback123', videoId: 'fallback123', title: 'Test Song' },
        ]);
        mockResolveStream.mockResolvedValue({
            streamUrl: 'https://stream.mteck.tech/yt/fallback123?format=m4a',
            codec: 'OPUS',
            bitrate: 160000,
        });

        const track = { id: 'track-1', title: 'Test Song', artist: { name: 'Test Artist' } };
        const result = await api.getStreamUrl(track.id, 'LOSSLESS', { track });

        expect(result.provider).toBe('youtube');
        expect(result.isFallback).toBe(true);
        expect(result.fallbackFrom).toBe('monochrome');
        expect(result.fallbackReason).toContain('Rate limited');
    });

    it('tags isFallback: true when YouTube stream fails and falls back to Monochrome studio release', async () => {
        // Track is YouTube
        const ytTrack = { id: 'yt:dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', provider: 'youtube', title: 'Never Gonna Give You Up' };
        
        mockResolveStream.mockRejectedValue(new Error('YouTube video removed'));

        api.tracksStreamerAPI.resolveTrackStream = vi.fn().mockResolvedValue({
            url: 'https://tracks.monochrome.st/stream/flac/never-gonna',
            codec: 'FLAC',
            bitrateKbps: 1411,
            lossless: true,
        });

        const result = await api.getStreamUrl(ytTrack.id, 'LOSSLESS', { track: ytTrack });

        expect(result.provider).toBe('monochrome');
        expect(result.isFallback).toBe(true);
        expect(result.fallbackFrom).toBe('youtube');
        expect(result.fallbackReason).toContain('YouTube video removed');
    });
});
