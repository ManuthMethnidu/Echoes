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
    const token = localStorage.getItem('echos_yt_token');
    if (!token) {
        throw new Error('Please connect your YouTube account first.');
    }
    const res = await fetch(`/api/yt/user-playlists?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
        // If token expired, clear it
        if (res.status === 401) {
            localStorage.removeItem('echos_yt_token');
        }
        throw new Error(data.error || 'Failed to load your YouTube playlists');
    }
    return data.playlists || [];
}

export async function importUserYouTubePlaylist(playlistId, playlistName) {
    const token = localStorage.getItem('echos_yt_token');
    if (!token) throw new Error('Not connected to YouTube');

    const res = await fetch(
        `/api/yt/user-playlist-tracks?playlistId=${encodeURIComponent(playlistId)}&token=${encodeURIComponent(token)}`
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

export function initYouTubeAccountUI() {
    const connectBtn = document.getElementById('yt-connect-btn');
    const playlistsContainer = document.getElementById('yt-user-playlists-list');

    if (!connectBtn || !playlistsContainer) return;

    const renderList = async () => {
        const token = localStorage.getItem('echos_yt_token');
        if (!token) {
            connectBtn.textContent = 'Connect YouTube';
            connectBtn.classList.remove('btn-secondary');
            connectBtn.classList.add('btn-primary');
            playlistsContainer.style.display = 'none';
            return;
        }

        connectBtn.textContent = 'Connected ✓';
        connectBtn.classList.remove('btn-primary');
        connectBtn.classList.add('btn-secondary');
        playlistsContainer.style.display = 'flex';
        playlistsContainer.innerHTML = '<p style="font-size:0.8rem; color:#aaa; margin:0;">Loading your YouTube playlists...</p>';

        try {
            const playlists = await getUserYouTubePlaylists();
            if (playlists.length === 0) {
                playlistsContainer.innerHTML = '<p style="font-size:0.8rem; color:#aaa; margin:0;">No playlists found.</p>';
                return;
            }

            playlistsContainer.innerHTML = playlists
                .map(
                    (p) => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: rgba(255,255,255,0.05); border-radius: 6px; gap: 10px;">
                    <img src="${p.thumbnail || 'images/echos_logo.svg'}" style="width: 34px; height: 34px; object-fit: cover; border-radius: 4px;" onerror="this.src='images/echos_logo.svg'" />
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(
                            p.title
                        )}</div>
                        <div style="font-size: 0.75rem; color: #888;">${
                            p.isLikedList ? 'Auto-synced' : p.itemCount ? `${p.itemCount} tracks` : 'YouTube Playlist'
                        }</div>
                    </div>
                    <button type="button" class="btn-primary yt-quick-import-btn" data-id="${p.id}" data-name="${escapeHtml(
                        p.title
                    )}" style="padding: 4px 10px; font-size: 0.75rem; white-space: nowrap;">
                        Import
                    </button>
                </div>
            `
                )
                .join('');

            playlistsContainer.querySelectorAll('.yt-quick-import-btn').forEach((btn) => {
                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = btn.getAttribute('data-id');
                    const name = btn.getAttribute('data-name');
                    btn.disabled = true;
                    btn.textContent = 'Importing...';
                    try {
                        await importUserYouTubePlaylist(id, name);
                        btn.textContent = 'Imported ✓';
                    } catch (err) {
                        alert(err.message || 'Import failed');
                        btn.disabled = false;
                        btn.textContent = 'Retry';
                    }
                });
            });
        } catch (err) {
            console.warn('Could not load user playlists:', err);
            playlistsContainer.innerHTML = `<p style="font-size:0.8rem; color:#ff4d4f; margin:0;">${err.message}</p>`;
        }
    };

    connectBtn.addEventListener('click', async () => {
        try {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting...';
            const res = await fetch('/api/auth/sign-in/social', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'youtube', callbackURL: window.location.href }),
            });
            const data = await res.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                throw new Error(data.error?.message || 'Google OAuth is not configured on server.');
            }
        } catch (err) {
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect YouTube';
            alert('Failed to connect YouTube: ' + err.message);
        }
    });

    renderList();
}
