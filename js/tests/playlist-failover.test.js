import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MusicAPI } from '../music-api.js';
import { ytEngine } from '../yt-music.js';
import { db } from '../db.js';

describe('MusicAPI playlist loading and failover', () => {
    let api;

    beforeEach(() => {
        vi.restoreAllMocks();
        api = new MusicAPI();
    });

    describe('_formatYtPlaylist', () => {
        it('normalizes YouTube playlist data to { playlist, tracks } structure', () => {
            const raw = {
                id: 'yt:playlist:PL123456',
                title: 'Summer Hits',
                author: 'Top Curator',
                thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
                videoCount: 1,
                tracks: [
                    {
                        id: 'yt:abc12345678',
                        videoId: 'abc12345678',
                        title: 'Summer Track',
                        artist: { name: 'Hot Artist' },
                    },
                ],
            };

            const result = api._formatYtPlaylist(raw, 'PL123456');

            expect(result).toHaveProperty('playlist');
            expect(result).toHaveProperty('tracks');
            expect(result.playlist.title).toBe('Summer Hits');
            expect(result.playlist.creator.name).toBe('Top Curator');
            expect(result.playlist.numberOfTracks).toBe(1);
            expect(result.playlist.squareImage).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
            expect(result.tracks.length).toBe(1);
            expect(result.tracks[0].id).toBe('yt:abc12345678');
        });
    });

    describe('getPlaylist routing and YouTube patterns', () => {
        it('routes PL-prefixed playlist IDs to YouTube engine', async () => {
            const spy = vi.spyOn(ytEngine, 'getPlaylist').mockResolvedValue({
                id: 'PL987654321',
                title: 'My PL Playlist',
                tracks: [],
            });

            const result = await api.getPlaylist('PL987654321');
            expect(spy).toHaveBeenCalledWith('PL987654321');
            expect(result.playlist.title).toBe('My PL Playlist');
        });

        it('routes RD-prefixed (Mix/Radio) playlist IDs to YouTube engine', async () => {
            const spy = vi.spyOn(ytEngine, 'getPlaylist').mockResolvedValue({
                id: 'RDCLAK5uy_test',
                title: 'Chill Mix',
                tracks: [],
            });

            const result = await api.getPlaylist('RDCLAK5uy_test');
            expect(spy).toHaveBeenCalledWith('RDCLAK5uy_test');
            expect(result.playlist.title).toBe('Chill Mix');
        });

        it('routes OLAK5uy_ (Album) playlist IDs to YouTube engine', async () => {
            const spy = vi.spyOn(ytEngine, 'getPlaylist').mockResolvedValue({
                id: 'OLAK5uy_album',
                title: 'Release Album Playlist',
                tracks: [],
            });

            const result = await api.getPlaylist('OLAK5uy_album');
            expect(spy).toHaveBeenCalledWith('OLAK5uy_album');
            expect(result.playlist.title).toBe('Release Album Playlist');
        });

        it('routes provider=youtube directly to YouTube engine', async () => {
            const spy = vi.spyOn(ytEngine, 'getPlaylist').mockResolvedValue({
                id: 'custom_yt_id',
                title: 'Explicit YT',
                tracks: [],
            });

            const result = await api.getPlaylist('custom_yt_id', 'youtube');
            expect(spy).toHaveBeenCalledWith('custom_yt_id');
            expect(result.playlist.title).toBe('Explicit YT');
        });
    });

    describe('VL virtual list and Community fallback', () => {
        it('strips VL prefix and falls back to YouTube engine if community fetch fails', async () => {
            vi.spyOn(ytEngine, 'getPlaylist').mockImplementation(async (cleanId) => {
                if (cleanId === 'PLvirtual123') {
                    return {
                        id: 'PLvirtual123',
                        title: 'Virtual Playlist',
                        tracks: [],
                    };
                }
                return null;
            });

            const result = await api.getPlaylist('VLPLvirtual123');
            expect(result.playlist.title).toBe('Virtual Playlist');
        });
    });

    describe('Failover when Tidal returns 404', () => {
        it('fails over to YouTube Music when Tidal API throws 404', async () => {
            vi.spyOn(api.tidalAPI, 'getPlaylist').mockRejectedValue(new Error('Request failed with status 404'));

            vi.spyOn(ytEngine, 'getPlaylist').mockResolvedValue({
                id: 'fallback_yt_playlist',
                title: 'YouTube Failover Playlist',
                tracks: [{ id: 'yt:xyz12345678', videoId: 'xyz12345678', title: 'Failover Song' }],
            });

            const result = await api.getPlaylist('some-missing-tidal-id');

            expect(result).toHaveProperty('playlist');
            expect(result).toHaveProperty('tracks');
            expect(result.playlist.title).toBe('YouTube Failover Playlist');
            expect(result.tracks.length).toBe(1);
        });

        it('fails over to Apple Music when Tidal throws 404 and YouTube returns null', async () => {
            vi.spyOn(api.tidalAPI, 'getPlaylist').mockRejectedValue(new Error('Request failed with status 404'));
            vi.spyOn(ytEngine, 'getPlaylist').mockResolvedValue(null);

            vi.spyOn(api.appleMusicSearchAPI, 'playlist').mockResolvedValue({
                playlist: {
                    id: 'pl.apple123',
                    title: 'Apple Failover Playlist',
                    numberOfTracks: 2,
                },
                tracks: [{ id: 'apple:1' }, { id: 'apple:2' }],
            });

            const result = await api.getPlaylist('pl.apple123');

            expect(result.playlist.title).toBe('Apple Failover Playlist');
            expect(result.tracks.length).toBe(2);
        });

        it('fails over to IndexedDB local database when Tidal throws 404 and external APIs fail', async () => {
            vi.spyOn(api.tidalAPI, 'getPlaylist').mockRejectedValue(new Error('Request failed with status 404'));
            vi.spyOn(ytEngine, 'getPlaylist').mockResolvedValue(null);
            vi.spyOn(api.appleMusicSearchAPI, 'playlist').mockRejectedValue(new Error('Not found'));

            vi.spyOn(db, 'getPlaylist').mockResolvedValue({
                id: 'local-user-playlist-uuid',
                name: 'My Saved Offline Playlist',
                tracks: [{ id: 't1', title: 'Track 1' }],
            });

            const result = await api.getPlaylist('local-user-playlist-uuid');

            expect(result.playlist.name).toBe('My Saved Offline Playlist');
            expect(result.playlist.numberOfTracks).toBe(1);
            expect(result.tracks.length).toBe(1);
        });
    });
});
