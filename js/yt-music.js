/**
 * echos - YouTube Music Client Engine (ArchiveTune style)
 */

export class YouTubeMusicEngine {
    constructor() {
        this.cache = new Map();
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

    async resolveStream(trackOrId) {
        const id = typeof trackOrId === 'string' ? trackOrId : trackOrId?.id || trackOrId?.videoId;
        if (!id) throw new Error('Invalid track ID');

        const cleanId = String(id).replace(/^yt:/, '');

        if (this.cache.has(cleanId)) {
            const cached = this.cache.get(cleanId);
            if (Date.now() - cached.timestamp < 30 * 60 * 1000) {
                return cached.data;
            }
        }

        const res = await fetch(`/api/yt/stream?id=${encodeURIComponent(cleanId)}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Failed to resolve YouTube audio (${res.status})`);
        }

        const data = await res.json();
        this.cache.set(cleanId, { data, timestamp: Date.now() });
        return data;
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
