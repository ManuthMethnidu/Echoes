/**
 * echos - YouTube Music Client Engine (ArchiveTune style)
 */

import { isIos, isSafari } from './platform-detection.js';

export class YouTubeMusicEngine {
    constructor() {
        this.cache = new Map();
        if (typeof window !== 'undefined') {
            window.ytEngine = this;
        }
    }

    async search(query) {
        if (!query || typeof query !== 'string') return [];
        const trimmed = query.trim();
        if (!trimmed) return [];

        try {
            const res = await fetch(`/api/yt/search?q=${encodeURIComponent(trimmed)}`);
            if (!res.ok) throw new Error(`Search error ${res.status}`);
            const data = await res.json();
            return data.results || [];
        } catch (err) {
            console.error('[echos YT Search]', err);
            return [];
        }
    }

    invalidateStream(trackOrId) {
        const id = typeof trackOrId === 'string' ? trackOrId : trackOrId?.id || trackOrId?.videoId;
        if (!id) return;
        const cleanId = String(id).replace(/^yt:/, '');
        this.cache.delete(cleanId);
    }

    async resolveStream(trackOrId) {
        const id = typeof trackOrId === 'string' ? trackOrId : trackOrId?.id || trackOrId?.videoId;
        if (!id) throw new Error('Invalid track ID');

        const cleanId = String(id).replace(/^yt:/, '');

        if (this.cache.has(cleanId)) {
            const cached = this.cache.get(cleanId);
            let isExpired = false;
            try {
                const sUrl = cached?.data?.streamUrl;
                if (sUrl) {
                    const u = new URL(sUrl);
                    const exp = parseInt(u.searchParams.get('expire'), 10);
                    if (!isNaN(exp) && exp <= Math.floor(Date.now() / 1000) + 60) {
                        isExpired = true;
                    }
                }
            } catch (_) {}

            if (!isExpired && Date.now() - cached.timestamp < 15 * 60 * 1000) {
                return cached.data;
            }
            this.cache.delete(cleanId);
        }

        const title = typeof trackOrId === 'object' ? trackOrId.title || '' : '';
        const artist =
            typeof trackOrId === 'object'
                ? trackOrId.artist?.name || (Array.isArray(trackOrId.artists) ? trackOrId.artists[0]?.name : '') || ''
                : '';
        const album =
            typeof trackOrId === 'object'
                ? trackOrId.album?.title || (typeof trackOrId.album === 'string' ? trackOrId.album : '') || ''
                : '';
        const params = new URLSearchParams({ id: cleanId });
        if (title) params.set('title', title);
        if (artist) params.set('artist', artist);
        if (album) params.set('album', album);

        try {
            const probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
            if (isIos || isSafari || !probe || !probe.canPlayType('audio/webm; codecs="opus"')) {
                params.set('format', 'm4a');
            }
        } catch {
            params.set('format', 'm4a');
        }

        const res = await fetch(`/api/yt/stream?${params.toString()}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Failed to resolve YouTube audio (${res.status})`);
        }

        const data = await res.json();
        this.cache.set(cleanId, { data, timestamp: Date.now() });
        return data;
    }

    async getArtist(idOrName) {
        if (!idOrName) return null;
        const clean = String(idOrName).replace(/^yt_art_/, '').replace(/^yt:/, '').trim();
        try {
            const res = await fetch(`/api/yt/artist?id=${encodeURIComponent(clean)}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            console.error('[echos YT Artist Error]', err);
            return null;
        }
    }

    async searchChannels(query) {
        if (!query) return [];
        try {
            const res = await fetch(`/api/yt/search?q=${encodeURIComponent(query)}&type=channel`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.results || [];
        } catch {
            return [];
        }
    }

    async getRadio(trackOrId) {
        const id = typeof trackOrId === 'string' ? trackOrId : trackOrId?.id || trackOrId?.videoId;
        if (!id) return [];

        const cleanId = String(id).replace(/^yt:/, '');
        try {
            const res = await fetch(`/api/yt/radio?id=${encodeURIComponent(cleanId)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.results || [];
        } catch {
            return [];
        }
    }

    async getPlaylist(trackOrId) {
        const id = typeof trackOrId === 'string' ? trackOrId : trackOrId?.id || trackOrId?.playlistId;
        if (!id) return null;

        const cleanId = String(id).replace(/^yt:playlist:/, '').replace(/^yt_alb_/, '').replace(/^yt:/, '');
        try {
            const res = await fetch(`/api/yt/playlist?id=${encodeURIComponent(cleanId)}`);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }

    async importSpotify(urlOrId) {
        if (!urlOrId) throw new Error('Please enter a Spotify playlist or album URL');
        const res = await fetch(`/api/import/spotify?url=${encodeURIComponent(urlOrId.trim())}`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to fetch Spotify playlist');
        }
        return data;
    }

    async getUserPlaylists(token = '') {
        const authToken = token || localStorage.getItem('echos_yt_token') || '';
        if (!authToken) {
            throw new Error('Please connect your YouTube account first.');
        }
        const res = await fetch(`/api/yt/user-playlists?token=${encodeURIComponent(authToken)}`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to load YouTube playlists');
        }
        return data.playlists || [];
    }

    async getUserPlaylistTracks(playlistId, token = '') {
        const authToken = token || localStorage.getItem('echos_yt_token') || '';
        const res = await fetch(
            `/api/yt/user-playlist-tracks?playlistId=${encodeURIComponent(playlistId)}&token=${encodeURIComponent(
                authToken
            )}`
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to load tracks from YouTube playlist');
        }
        return data.tracks || [];
    }
}

export const ytEngine = new YouTubeMusicEngine();
export default ytEngine;
