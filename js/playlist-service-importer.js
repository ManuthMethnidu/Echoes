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

    // Process in parallel batches of 4 to match tracks swiftly
    const BATCH_SIZE = 4;
    for (let i = 0; i < rawTracks.length; i += BATCH_SIZE) {
        const batch = rawTracks.slice(i, i + BATCH_SIZE);
        await Promise.all(
            batch.map(async (item, batchIdx) => {
                const idx = i + batchIdx;
                if (onProgress) {
                    onProgress({
                        current: Math.min(idx + 1, total),
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
                            const thumb = top.cover || top.image || (top.videoId ? `https://i.ytimg.com/vi/${top.videoId}/hqdefault.jpg` : '');
                            matchedTracks.push({
                                ...top,
                                trackNumber: idx + 1,
                                duration: top.duration || item.duration || 0,
                                cover: thumb,
                                image: thumb,
                                album: {
                                    ...(top.album || {}),
                                    cover: thumb,
                                },
                            });
                            return;
                        }
                    }
                    missingTracks.push(item);
                } catch (err) {
                    console.warn(`Failed to match track: ${item.title}`, err);
                    missingTracks.push(item);
                }
            })
        );
    }

    // Sort matched tracks back in original track order
    matchedTracks.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));

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

    const spotifyInput = document.getElementById('spotify-url-input');
    const spotifyFetchBtn = document.getElementById('spotify-fetch-btn');
    const spotifyStatusEl = document.getElementById('spotify-status');

    const nameInput = document.getElementById('playlist-name-input');
    const coverInput = document.getElementById('playlist-cover-input');
    const descInput = document.getElementById('playlist-description-input');
    const modal = document.getElementById('playlist-modal');

    // Wire up Direct Spotify Playlist Import
    if (spotifyFetchBtn && spotifyInput) {
        spotifyFetchBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const url = spotifyInput.value.trim();
            if (!url) {
                if (spotifyStatusEl) {
                    spotifyStatusEl.textContent = 'Please paste a public Spotify playlist or album link.';
                    spotifyStatusEl.style.color = '#ef4444';
                }
                return;
            }

            spotifyFetchBtn.disabled = true;
            spotifyFetchBtn.textContent = 'Fetching...';
            if (spotifyStatusEl) {
                spotifyStatusEl.textContent = 'Fetching metadata directly from Spotify...';
                spotifyStatusEl.style.color = '#1ed760';
            }

            try {
                const data = await fetchSpotifyMetadata(url);
                const count = data.tracks?.length || 0;
                if (count === 0) {
                    if (spotifyStatusEl) {
                        spotifyStatusEl.textContent = 'No tracks found. Please make sure the Spotify playlist is public.';
                        spotifyStatusEl.style.color = '#ef4444';
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

                // Cache metadata on modal
                if (modal) {
                    modal._cachedSpotifyData = data;
                }

                if (spotifyStatusEl) {
                    spotifyStatusEl.innerHTML = `<span style="color:#10b981;">Found ${count} tracks: "${escapeHtml(data.name)}". Click Save to finish importing!</span>`;
                }
            } catch (err) {
                console.error('[Spotify Fetch Error]:', err);
                if (spotifyStatusEl) {
                    spotifyStatusEl.textContent = `Error: ${err.message || 'Failed to load Spotify playlist'}`;
                    spotifyStatusEl.style.color = '#ef4444';
                }
            } finally {
                spotifyFetchBtn.disabled = false;
                spotifyFetchBtn.textContent = 'Fetch & Preview';
            }
        });
    }

    // Wire up General File Input (.csv, .jspf, .xspf, .xml, .m3u)
    const generalFileInput = document.getElementById('general-file-input');
    if (generalFileInput) {
        generalFileInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const name = file.name.toLowerCase();
            let targetInputId = 'csv-file-input';
            if (name.endsWith('.jspf')) targetInputId = 'jspf-file-input';
            else if (name.endsWith('.xspf')) targetInputId = 'xspf-file-input';
            else if (name.endsWith('.xml')) targetInputId = 'xml-file-input';
            else if (name.endsWith('.m3u') || name.endsWith('.m3u8')) targetInputId = 'm3u-file-input';

            // Clear other file inputs
            ['csv-file-input', 'jspf-file-input', 'xspf-file-input', 'xml-file-input', 'm3u-file-input'].forEach((id) => {
                const el = document.getElementById(id);
                if (el && id !== targetInputId) el.value = '';
            });

            // Assign file to specific target input using DataTransfer
            const targetInput = document.getElementById(targetInputId);
            if (targetInput && e.target.files) {
                const dt = new DataTransfer();
                dt.items.add(file);
                targetInput.files = dt.files;
            }

            // Auto-fill playlist name if empty
            if (nameInput && (!nameInput.value.trim() || nameInput.value === 'Create Playlist')) {
                const cleanName = file.name.replace(/\.[^/.]+$/, '');
                nameInput.value = cleanName;
            }
        });
    }

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
