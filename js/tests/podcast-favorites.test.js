import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { MusicDatabase } from '../db.js';

describe('Podcast Favorites in MusicDatabase', () => {
    let db;
    const TEST_DB_NAME = 'TestPodcastFavoritesDB';

    beforeEach(async () => {
        db = new MusicDatabase();
        db.dbName = TEST_DB_NAME;
        const req = indexedDB.deleteDatabase(TEST_DB_NAME);
        await new Promise((resolve) => {
            req.onsuccess = resolve;
            req.onerror = resolve;
        });
    });

    afterEach(async () => {
        if (db.db) {
            db.db.close();
        }
        const req = indexedDB.deleteDatabase(TEST_DB_NAME);
        await new Promise((resolve) => {
            req.onsuccess = resolve;
            req.onerror = resolve;
        });
    });

    test('creates favorites_podcasts object store with addedAt index', async () => {
        const openedDb = await db.open();
        expect(openedDb.objectStoreNames.contains('favorites_podcasts')).toBe(true);
    });

    test('toggleFavorite adds and removes podcast shows correctly', async () => {
        const podcast = {
            id: '78910',
            title: 'The AI Podcast',
            author: 'Open Source Community',
            image: 'https://example.com/cover.jpg',
            description: 'Discussing the future of open agents',
            episodeCount: 42,
            feedUrl: 'https://example.com/feed.xml',
        };

        // Like podcast
        const added = await db.toggleFavorite('podcast', podcast);
        expect(added).toBe(true);

        // Check isFavorite with string and number
        expect(await db.isFavorite('podcast', '78910')).toBe(true);
        expect(await db.isFavorite('podcast', 78910)).toBe(true);

        const favorites = await db.getFavorites('podcast');
        expect(favorites.length).toBe(1);
        expect(favorites[0].id).toBe('78910');
        expect(favorites[0].title).toBe('The AI Podcast');
        expect(favorites[0].author).toBe('Open Source Community');
        expect(favorites[0].episodeCount).toBe(42);
        expect(favorites[0]._href).toBe('/podcasts/78910');

        // Unlike podcast
        const removed = await db.toggleFavorite('podcast', podcast);
        expect(removed).toBe(false);

        expect(await db.isFavorite('podcast', '78910')).toBe(false);
        const favoritesAfter = await db.getFavorites('podcast');
        expect(favoritesAfter.length).toBe(0);
    });

    test('correctly minifies and preserves podcast show properties', () => {
        const rawPodcast = {
            id: 998877,
            title: 'Hardcore Tech',
            author: 'Tech Guru',
            cover: 'https://example.com/cover.png',
            description: '<p>A <b>cool</b> podcast show</p>',
            episodeCount: 15,
            feedUrl: 'https://example.com/rss',
            categories: { Technology: 'Tech News' },
            explicit: false,
        };

        const minified = db._minifyItem('podcast', rawPodcast);
        expect(minified.id).toBe('998877');
        expect(minified.title).toBe('Hardcore Tech');
        expect(minified.author).toBe('Tech Guru');
        expect(minified.image).toBe('https://example.com/cover.png');
        expect(minified.episodeCount).toBe(15);
        expect(minified.feedUrl).toBe('https://example.com/rss');
        expect(minified._href).toBe('/podcasts/998877');
    });

    test('correctly stores podcast episodes in favorites_tracks with podcast metadata', async () => {
        const episodeTrack = {
            id: 'podcast_ep_12345',
            title: 'Episode 1: The Beginning',
            artist: { id: null, name: 'The History Podcast' },
            album: { id: null, title: 'The History Podcast', cover: 'https://example.com/ep.jpg' },
            duration: 3600,
            isPodcast: true,
            podcastId: '54321',
            feedId: '54321',
            feedTitle: 'The History Podcast',
            enclosureUrl: 'https://example.com/audio.mp3',
            enclosureType: 'audio/mpeg',
        };

        const added = await db.toggleFavorite('track', episodeTrack);
        expect(added).toBe(true);

        const isFav = await db.isFavorite('track', 'podcast_ep_12345');
        expect(isFav).toBe(true);

        const favTracks = await db.getFavorites('track');
        expect(favTracks.length).toBe(1);
        expect(favTracks[0].id).toBe('podcast_ep_12345');
        expect(favTracks[0].isPodcast).toBe(true);
        expect(favTracks[0].podcastId).toBe('54321');
        expect(favTracks[0].enclosureUrl).toBe('https://example.com/audio.mp3');
    });

    test('clearUserData clears favorites_podcasts', async () => {
        await db.toggleFavorite('podcast', { id: 'pod1', title: 'Pod 1' });
        expect((await db.getFavorites('podcast')).length).toBe(1);

        const cleared = await db.clearUserData();
        expect(cleared).toBe(true);
        expect((await db.getFavorites('podcast')).length).toBe(0);
    });

    test('exportData and importData support favorites_podcasts', async () => {
        await db.toggleFavorite('podcast', {
            id: 'pod_abc',
            title: 'Audio Show',
            author: 'Host A',
        });

        const exported = await db.exportData();
        expect(exported.favorites_podcasts).toBeDefined();
        expect(exported.favorites_podcasts.length).toBe(1);
        expect(exported.favorites_podcasts[0].id).toBe('pod_abc');

        // Clear and reimport
        await db.clearUserData();
        expect((await db.getFavorites('podcast')).length).toBe(0);

        await db.importData(exported);
        const reimported = await db.getFavorites('podcast');
        expect(reimported.length).toBe(1);
        expect(reimported[0].id).toBe('pod_abc');
        expect(reimported[0].title).toBe('Audio Show');
    });
});
