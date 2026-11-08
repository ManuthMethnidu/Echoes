// js/offline-storage.js
import { getTrackTitle, getTrackArtists } from './utils.js';
import { MusicAPI } from './music-api.js';

export class OfflineStorage {
    constructor() {
        this.dbName = 'echos-offline-cache';
        this.dbVersion = 1;
        this.db = null;
        this.cachedIds = new Set();
        this._initPromise = this.initDB();
    }

    async initDB() {
        if (typeof indexedDB === 'undefined') return null;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('[OfflineStorage] Database open error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.db.onversionchange = () => {
                    try {
                        this.db?.close();
                    } catch {}
                    this.db = null;
                };
                this.db.onclose = () => {
                    this.db = null;
                };
                this._refreshCachedIds().catch(() => {});
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('tracks')) {
                    const store = db.createObjectStore('tracks', { keyPath: 'id' });
                    store.createIndex('cachedAt', 'cachedAt', { unique: false });
                    store.createIndex('title', 'title', { unique: false });
                    store.createIndex('artist', 'artist', { unique: false });
                }
            };
        });
    }

    async getDB() {
        if (this.db) return this.db;
        return await this._initPromise;
    }

    async _refreshCachedIds() {
        try {
            const db = await this.getDB();
            if (!db) return;
            const tx = db.transaction('tracks', 'readonly');
            const store = tx.objectStore('tracks');
            const request = store.getAllKeys();
            request.onsuccess = () => {
                this.cachedIds = new Set(request.result.map(String));
            };
        } catch (e) {
            console.warn('[OfflineStorage] Refresh IDs failed:', e);
        }
    }

    hasTrackSync(trackId) {
        if (!trackId) return false;
        return this.cachedIds.has(String(trackId));
    }

    async hasTrack(trackId) {
        if (!trackId) return false;
        const cleanId = String(trackId);
        if (this.cachedIds.has(cleanId)) return true;
        const db = await this.getDB();
        if (!db) return false;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction('tracks', 'readonly');
                const store = tx.objectStore('tracks');
                const req = store.getKey(cleanId);
                req.onsuccess = () => {
                    const has = req.result !== undefined;
                    if (has) this.cachedIds.add(cleanId);
                    resolve(has);
                };
                req.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    async getTrack(trackId) {
        if (!trackId) return null;
        const cleanId = String(trackId);
        const db = await this.getDB();
        if (!db) return null;

        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction('tracks', 'readonly');
                const store = tx.objectStore('tracks');
                const req = store.get(cleanId);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    async getAllTracks() {
        const db = await this.getDB();
        if (!db) return [];

        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction('tracks', 'readonly');
                const store = tx.objectStore('tracks');
                const req = store.getAll();
                req.onsuccess = () => {
                    const tracks = req.result || [];
                    tracks.sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));
                    this.cachedIds = new Set(tracks.map((t) => String(t.id)));
                    resolve(tracks);
                };
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    async saveTrack(track, audioBlob, options = {}) {
        if (!track || !audioBlob) throw new Error('Missing track or audioBlob');
        const db = await this.getDB();
        if (!db) throw new Error('Offline database not available');

        const trackId = String(track.id);
        const title = getTrackTitle(track) || track.title || track.name || 'Unknown Title';
        const artist =
            getTrackArtists(track) ||
            track.artist?.name ||
            (typeof track.artist === 'string' ? track.artist : 'Unknown Artist');

        const record = {
            id: trackId,
            title,
            name: title,
            artist: { name: artist },
            artists: track.artists || [{ name: artist }],
            album: track.album || { title: 'Unknown Album' },
            duration: Number(track.duration) || 0,
            cover: track.cover || track.image || track.album?.cover || null,
            image: track.cover || track.image || track.album?.cover || null,
            coverBlob: options.coverBlob || null,
            audioBlob,
            mimeType: audioBlob.type || 'audio/flac',
            sizeBytes: audioBlob.size,
            lyrics: options.lyrics || null,
            cachedAt: Date.now(),
            provider: track.provider || 'default',
            audioQuality: track.audioQuality || 'LOSSLESS',
            isOffline: true,
        };

        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction('tracks', 'readwrite');
                const store = tx.objectStore('tracks');
                const req = store.put(record);
                req.onsuccess = () => {
                    this.cachedIds.add(trackId);
                    window.dispatchEvent(
                        new CustomEvent('offline-tracks-changed', {
                            detail: { trackId, action: 'add' },
                        })
                    );
                    resolve(record);
                };
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    async removeTrack(trackId) {
        if (!trackId) return;
        const cleanId = String(trackId);
        const db = await this.getDB();
        if (!db) return;

        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction('tracks', 'readwrite');
                const store = tx.objectStore('tracks');
                const req = store.delete(cleanId);
                req.onsuccess = () => {
                    this.cachedIds.delete(cleanId);
                    window.dispatchEvent(
                        new CustomEvent('offline-tracks-changed', {
                            detail: { trackId: cleanId, action: 'remove' },
                        })
                    );
                    resolve();
                };
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    async clearAll() {
        const db = await this.getDB();
        if (!db) return;

        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction('tracks', 'readwrite');
                const store = tx.objectStore('tracks');
                const req = store.clear();
                req.onsuccess = () => {
                    this.cachedIds.clear();
                    window.dispatchEvent(
                        new CustomEvent('offline-tracks-changed', {
                            detail: { action: 'clear' },
                        })
                    );
                    resolve();
                };
                req.onerror = () => reject(req.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    async getStorageUsage() {
        const tracks = await this.getAllTracks();
        let totalBytes = 0;
        for (const t of tracks) {
            totalBytes += Number(t.sizeBytes) || (t.audioBlob ? t.audioBlob.size : 0);
        }
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);
        return { bytes: totalBytes, mb, count: tracks.length };
    }

    async cacheTrack(track, api = null, lyricsManager = null, options = {}) {
        if (!track?.id) throw new Error('Invalid track');
        const cleanId = String(track.id);

        if (await this.hasTrack(cleanId)) {
            return await this.getTrack(cleanId);
        }

        const musicApi = api || MusicAPI.instance;
        if (!musicApi) throw new Error('MusicAPI not initialized');

        // Download audio blob (without prompting user to save file to disk)
        const audioBlob = await musicApi.downloadTrack(track.id, 'LOSSLESS', undefined, {
            track,
            calculateDashBytes: false,
            triggerDownload: false,
            signal: options.signal,
            onProgress: options.onProgress,
            ...options,
        });

        if (!audioBlob || audioBlob.size === 0) {
            throw new Error('Downloaded audio stream was empty');
        }

        // Fetch cover blob
        let coverBlob = null;
        const coverId = track.image || track.cover || track.album?.cover;
        if (coverId) {
            try {
                const coverUrl = musicApi.getCoverUrl(coverId, '320');
                if (coverUrl && !coverUrl.startsWith('data:') && !coverUrl.startsWith('blob:')) {
                    const res = await fetch(coverUrl, { signal: options.signal });
                    if (res.ok) coverBlob = await res.blob();
                }
            } catch {}
        }

        // Fetch lyrics
        let lyrics = null;
        if (lyricsManager?.fetchLyrics) {
            try {
                lyrics = await lyricsManager.fetchLyrics(track.id, track);
            } catch {}
        }

        return await this.saveTrack(track, audioBlob, { coverBlob, lyrics });
    }

    toPlayerTrack(record) {
        const coverUrl = record.coverBlob
            ? URL.createObjectURL(record.coverBlob)
            : record.cover || record.image || '/images/echos_logo.svg';
        return {
            ...record,
            id: record.id,
            title: record.title || record.name,
            name: record.title || record.name,
            artist: record.artist || { name: 'Unknown Artist' },
            artists: record.artists || [record.artist],
            album: record.album || { title: 'Unknown Album' },
            duration: record.duration,
            cover: coverUrl,
            image: coverUrl,
            isOffline: true,
            audioBlob: record.audioBlob,
        };
    }

    async findNextCachedIndex(queue, startIndex = 0) {
        if (!Array.isArray(queue) || queue.length === 0) return -1;
        for (let i = startIndex + 1; i < queue.length; i++) {
            if (await this.hasTrack(queue[i]?.id)) return i;
        }
        for (let i = 0; i <= startIndex; i++) {
            if (await this.hasTrack(queue[i]?.id)) return i;
        }
        return -1;
    }
}

export const offlineStorage = new OfflineStorage();
