import { db } from './db.js';
import { syncManager } from './accounts/pocketbase.js';
import { UIRenderer } from './ui.js';
import { showNotification } from './downloads.js';
import { escapeHtml } from './utils.js';

export async function fetchSpotifyMetadata(url) {
    const res = await fetch(`/api/import/spotify?url=${encodeURIComponent(url.trim())}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to fetch Spotify playlist');
    }
    return data;
}

export async function importSpotifyTracks(spotifyData, onProgress) {
    const rawTracks = spotifyData.tracks || [];
    const matchedTracks = [];
    const missingTracks = [];
    const total = rawTracks.length;

    for (let i = 0; i < rawTracks.length; i++) {
        const item = rawTracks[i];
        if (onProgress) {
            onProgress({
                current: i + 1,
                total,
                trackTitle: item.title,
                artist: item.artist,
            });
        }

        try {
            const query = `${item.title} ${item.artist}`.trim();
            const searchRes = await fetch(`/api/yt/search?q=${encodeURIComponent(query)}`);
            if (searchRes.ok) {
                const searchData = await searchRes.json();
                const results = searchData.results || [];
                if (results.length > 0) {
                    const top = results[0];
                    matchedTracks.push({
                        ...top,
                        trackNumber: i + 1,
                        duration: top.duration || item.duration || 0,
                    });
                    continue;
                }
            }
            missingTracks.push(item);
        } catch (err) {
            console.warn(`Failed to match track: ${item.title}`, err);
            missingTracks.push(item);
        }
    }

    return {
        name: spotifyData.name,
        cover: spotifyData.cover,
        description: spotifyData.description,
        tracks: matchedTracks,
        missingTracks,
    };
}

export async function fetchYouTubePlaylist(urlOrId) {
    const res = await fetch(`/api/yt/playlist?url=${encodeURIComponent(urlOrId.trim())}`);
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch YouTube playlist');
    }
    return {
        name: data.title || 'YouTube Playlist',
        cover: data.cover || data.thumbnail || '',
        description: data.description || '',
        tracks: data.tracks || [],
    };
}

export async function getUserYouTubePlaylists() {
    const directToken = localStorage.getItem('echos_yt_token');
    const userAuthToken = localStorage.getItem('echos-auth-token') || localStorage.getItem('monochrome-auth-token');
    
    if (!directToken && !userAuthToken) {
        throw new Error('Please sign in with Google or connect your YouTube account.');
    }

    const headers = {};
    if (directToken) {
        headers['Authorization'] = `Bearer ${directToken}`;
    } else if (userAuthToken) {
        headers['Authorization'] = `Bearer ${userAuthToken}`;
    }

    const res = await fetch(`/api/yt/user-playlists`, { headers });
    const data = await res.json();
    if (!res.ok || !data.ok) {
        if (res.status === 401 && directToken) {
            localStorage.removeItem('echos_yt_token');
        }
        throw new Error(data.error || 'Failed to load your YouTube playlists');
    }
    return data.playlists || [];
}

export async function importUserYouTubePlaylist(playlistId, playlistName) {
    const directToken = localStorage.getItem('echos_yt_token');
    const userAuthToken = localStorage.getItem('echos-auth-token') || localStorage.getItem('monochrome-auth-token');
    
    if (!directToken && !userAuthToken) {
        throw new Error('Not connected to YouTube');
    }

    const headers = {};
    if (directToken) {
        headers['Authorization'] = `Bearer ${directToken}`;
    } else if (userAuthToken) {
        headers['Authorization'] = `Bearer ${userAuthToken}`;
    }

    const res = await fetch(
        `/api/yt/user-playlist-tracks?playlistId=${encodeURIComponent(playlistId)}`,
        { headers }
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to load playlist tracks from YouTube');
    }

    const tracks = data.tracks || [];
    if (tracks.length === 0) {
        throw new Error('No tracks found in this playlist.');
    }

    const cover = tracks[0]?.cover || '';
    const playlist = await db.createPlaylist(playlistName, tracks, cover, 'Imported from YouTube Music');
    await syncManager.syncUserPlaylist(playlist, 'create');
    UIRenderer.instance.renderLibraryPage();
    showNotification(`Imported "${playlistName}" (${tracks.length} tracks) to library!`);
    return playlist;
}

export function initTuneMyMusicAndYouTubeUI() {
    const ytmInput = document.getElementById('ytm-url-input');
    const fetchBtn = document.getElementById('ytm-fetch-btn');
    const statusEl = document.getElementById('ytm-status');
    const nameInput = document.getElementById('playlist-name-input');
    const coverInput = document.getElementById('playlist-cover-input');
    const descInput = document.getElementById('playlist-description-input');

    if (!fetchBtn || !ytmInput) return;

    fetchBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = ytmInput.value.trim();
        if (!url) {
            if (statusEl) {
                statusEl.textContent = 'Please paste a YouTube or YouTube Music playlist link.';
                statusEl.style.color = '#ef4444';
            }
            return;
        }

        fetchBtn.disabled = true;
        fetchBtn.textContent = 'Fetching...';
        if (statusEl) {
            statusEl.textContent = 'Fetching playlist metadata from YouTube...';
            statusEl.style.color = '#38bdf8';
        }

        try {
            const data = await fetchYouTubePlaylist(url);
            const count = data.tracks?.length || 0;
            if (count === 0) {
                if (statusEl) {
                    statusEl.textContent = 'No tracks found in this playlist. Please ensure it is public or unlisted.';
                    statusEl.style.color = '#ef4444';
                }
                return;
            }

            if (nameInput && (!nameInput.value.trim() || nameInput.value === 'Create Playlist')) {
                nameInput.value = data.name;
            }
            if (coverInput && !coverInput.value.trim() && data.cover) {
                coverInput.value = data.cover;
            }
            if (descInput && !descInput.value.trim() && data.description) {
                descInput.value = data.description;
            }

            if (statusEl) {
                statusEl.innerHTML = `<span style="color:#10b981;">Found ${count} tracks: "${escapeHtml(data.name)}". Click Save to finish!</span>`;
            }
        } catch (err) {
            console.error('[YouTube Fetch Error]:', err);
            if (statusEl) {
                statusEl.textContent = `Error: ${err.message || 'Failed to load playlist'}`;
                statusEl.style.color = '#ef4444';
            }
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.textContent = 'Fetch & Preview';
        }
    });
}

export function initYouTubeAccountUI() {
    initTuneMyMusicAndYouTubeUI();
}
