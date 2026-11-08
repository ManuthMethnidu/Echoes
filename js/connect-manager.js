// js/connect-manager.js
import { authManager } from './accounts/auth.js';
import { Player } from './player.js';

/**
 * Safely serialize track object preserving all metadata required for playback streaming
 * (artists, album, isrc, provider, audioUrl, tracksTrackId, tidalTrackId, type, etc.)
 */
export function serializeTrack(track) {
    if (!track || typeof track !== 'object') return null;
    try {
        const copy = JSON.parse(
            JSON.stringify(track, (key, value) => {
                if (typeof value === 'function' || value instanceof Element || (typeof key === 'string' && key.startsWith('_'))) {
                    return undefined;
                }
                return value;
            })
        );
        // Ensure artists array is always populated for getTrackArtists / getTrackArtistsHTML
        if (!Array.isArray(copy.artists) || copy.artists.length === 0) {
            const name = typeof copy.artist === 'string' ? copy.artist : (copy.artist?.name || 'Unknown Artist');
            copy.artists = [{ id: '', name }];
        }
        if (!copy.artist || typeof copy.artist !== 'string') {
            copy.artist = copy.artists[0]?.name || (copy.artist?.name || 'Unknown Artist');
        }
        return copy;
    } catch (_e) {
        const artistStr = typeof track.artist === 'string' ? track.artist : (track.artists?.[0]?.name || 'Unknown Artist');
        return {
            id: track.id,
            title: track.title || 'Unknown Title',
            artist: artistStr,
            artists: Array.isArray(track.artists) ? track.artists : [{ id: '', name: artistStr }],
            album: track.album || null,
            cover: track.cover || track.image || track.album?.cover || null,
            duration: track.duration || 0,
            provider: track.provider || null,
            isrc: track.isrc || null,
            audioUrl: track.audioUrl || null,
            type: track.type || 'track',
            tracksTrackId: track.tracksTrackId || null,
            tidalTrackId: track.tidalTrackId || null,
        };
    }
}

/**
 * Detect friendly device type and OS description
 */
export function getDeviceInfo() {
    const ua = navigator.userAgent;
    let type = 'desktop';
    let name = 'Desktop Browser';

    if (/SmartTV|Smart-TV|Tizen|Web0S|NetCast|GoogleTV|AppleTV|HbbTV|BRAVIA|Viera|Roku/i.test(ua)) {
        type = 'tv';
        name = /Tizen/i.test(ua)
            ? 'Samsung Smart TV'
            : /Web0S|LG/i.test(ua)
            ? 'LG Smart TV'
            : /AppleTV/i.test(ua)
            ? 'Apple TV'
            : 'Smart TV';
    } else if (/iPhone/i.test(ua)) {
        type = 'mobile';
        name = 'iPhone';
    } else if (/iPad/i.test(ua)) {
        type = 'tablet';
        name = 'iPad';
    } else if (/Android/i.test(ua)) {
        if (/Tablet|Nexus 7|Nexus 9|Nexus 10/i.test(ua)) {
            type = 'tablet';
            name = 'Android Tablet';
        } else {
            type = 'mobile';
            name = 'Android Phone';
        }
    } else if (/Macintosh|Mac OS X/i.test(ua)) {
        name = 'Mac';
    } else if (/Windows NT/i.test(ua)) {
        name = 'Windows PC';
    } else if (/Linux/i.test(ua)) {
        name = 'Linux';
    }

    return { type, name };
}

export class ConnectManager {
    static #instance = null;

    static get instance() {
        if (!ConnectManager.#instance) {
            ConnectManager.#instance = new ConnectManager();
        }
        return ConnectManager.#instance;
    }

    constructor() {
        const storedId = localStorage.getItem('echos_connect_device_id');
        this.deviceId = storedId || 'dev_' + Math.random().toString(36).substring(2, 10);
        if (!storedId) {
            localStorage.setItem('echos_connect_device_id', this.deviceId);
        }

        const info = getDeviceInfo();
        this.deviceType = info.type;
        this.deviceName = localStorage.getItem('echos_connect_device_name') || info.name;

        this.ws = null;
        this.broadcastChannel = null;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.syncThrottleTimer = null;

        this.devices = [];
        this.activeDeviceId = this.deviceId;
        this.activeDeviceName = this.deviceName;
        this.remotePlayback = null;
        this.isLocalActive = true;
        this.modalEl = null;
        this.bannerEl = null;

        this.initBroadcastFallback();
    }

    /**
     * Normalize device objects across Cloudflare Edge Worker payloads and local BroadcastChannel
     */
    normalizeDevices(devices) {
        if (!Array.isArray(devices)) return [];
        return devices.map((d) => {
            const id = d.id || d.deviceId || '';
            const name = d.name || d.deviceName || 'Unknown Device';
            const type = d.type || d.deviceType || 'desktop';
            return {
                id,
                deviceId: id,
                name,
                deviceName: name,
                type,
                deviceType: type,
                isActive: Boolean(d.isActive || (id && id === this.activeDeviceId)),
                connectedAt: d.connectedAt || Date.now(),
            };
        });
    }

    /**
     * Initializes local BroadcastChannel to enable instant multi-tab sync
     * and local testing (e.g. Tab 1 as "Phone", Tab 2 as "Smart TV").
     */
    initBroadcastFallback() {
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
            try {
                this.broadcastChannel = new BroadcastChannel('echos_connect_bus');
                this.broadcastChannel.onmessage = (event) => {
                    this.handleIncomingMessage(event.data);
                };
            } catch (_e) {}
        }
        this.currentUserId = null;
    }

    /**
     * Initialize connection with user credentials and edge worker
     */
    async init() {
        this.setupPlayerListeners();
        this.setupUI();

        // Listen for auth state changes to connect to the user's specific room
        authManager.onAuthStateChanged((user) => {
            const uid = user?.$id || user?.id || null;
            this.connect(uid);
        });

        const currentUser = authManager.user;
        this.connect(currentUser?.$id || currentUser?.id || null);
    }

    /**
     * Resolve Cloudflare Worker WebSocket URL
     */
    getWsUrl(userId) {
        if (!userId || userId === 'guest') return null;
        const override =
            localStorage.getItem('echos-connect-ws-url') ||
            (typeof window !== 'undefined' && window.__ECHOS_CONNECT_WS_URL__) ||
            'wss://stream.mteck.tech/ws';
        if (override) {
            const u = new URL(override);
            u.searchParams.set('userId', userId);
            u.searchParams.set('deviceId', this.deviceId);
            u.searchParams.set('deviceName', this.deviceName);
            u.searchParams.set('deviceType', this.deviceType);
            return u.toString();
        }

        // Default to secure Cloudflare edge worker endpoint
        const host = window.location.host;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${host}/api/connect/ws?userId=${encodeURIComponent(
            userId
        )}&deviceId=${encodeURIComponent(this.deviceId)}&deviceName=${encodeURIComponent(
            this.deviceName
        )}&deviceType=${encodeURIComponent(this.deviceType)}`;
    }

    /**
     * Connect to Cloudflare Worker WebSocket
     */
    connect(userId = null) {
        // Connected devices is strictly an authenticated cross-device feature for the same user.
        // If unauthenticated or guest, cleanly disconnect and reset to local playback.
        if (!userId || userId === 'guest') {
            if (this.ws) {
                try {
                    this.ws.close();
                } catch (_) {}
                this.ws = null;
            }
            this.currentUserId = null;
            this.stopHeartbeat();
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            this.isLocalActive = true;
            this.activeDeviceId = this.deviceId;
            this.activeDeviceName = this.deviceName;
            this.devices = [];
            this.remotePlayback = null;
            this.updateRemoteBanner();
            this.renderModalDeviceList();
            return;
        }

        const targetUserId = userId;

        // If already connected to this exact user room, no-op
        if (this.ws && this.currentUserId === targetUserId && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        // If user changed, close existing socket
        if (this.ws) {
            try {
                this.ws.close();
            } catch (_) {}
            this.ws = null;
        }

        this.currentUserId = targetUserId;
        const wsUrl = this.getWsUrl(targetUserId);
        if (!wsUrl) return;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[Echos Connect] Connected to Cloudflare Edge room');
                this.startHeartbeat();
                this.send({
                    type: 'REGISTER_DEVICE',
                    deviceId: this.deviceId,
                    deviceName: this.deviceName,
                    deviceType: this.deviceType,
                });
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleIncomingMessage(data);
                } catch (e) {
                    console.error('[Echos Connect] Bad message', e);
                }
            };

            this.ws.onclose = () => {
                this.stopHeartbeat();
                this.scheduleReconnect(targetUserId);
            };

            this.ws.onerror = () => {
                // Keep local broadcast fallback active
            };
        } catch (_e) {
            this.scheduleReconnect(targetUserId);
        }
    }

    scheduleReconnect(userId) {
        if (!userId || userId === 'guest') return;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.connect(userId);
        }, 5000);
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.send({ type: 'PING' });
        }, 25000);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }

    send(msg) {
        // Send via WebSocket if online
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(msg));
            } catch (_e) {}
        }

        // Also broadcast locally across browser tabs
        if (this.broadcastChannel) {
            try {
                this.broadcastChannel.postMessage(msg);
            } catch (_e) {}
        }
    }

    /**
     * Central message processor (handles both WebSocket and BroadcastChannel messages)
     */
    handleIncomingMessage(msg) {
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'SESSION_STATE':
                this.devices = this.normalizeDevices(msg.devices);
                if (msg.activeDeviceId) {
                    this.setActiveDevice(msg.activeDeviceId, msg.activeDeviceName);
                }
                if (msg.playback || msg.playbackState) {
                    const pb = msg.playback || msg.playbackState;
                    this.remotePlayback = pb;
                    if (!this.isLocalActive) {
                        this.renderRemoteState(pb);
                    }
                }
                this.renderModalDeviceList();
                this.updateRemoteBanner();
                break;

            case 'DEVICES_CHANGED':
                this.devices = this.normalizeDevices(msg.devices);
                if (msg.activeDeviceId) {
                    this.setActiveDevice(msg.activeDeviceId);
                }
                this.renderModalDeviceList();
                break;

            case 'ACTIVE_DEVICE_CHANGED':
                this.setActiveDevice(msg.activeDeviceId, msg.activeDeviceName);
                if (msg.devices) this.devices = this.normalizeDevices(msg.devices);
                if (msg.playback && !this.isLocalActive) {
                    this.remotePlayback = msg.playback;
                    this.renderRemoteState(msg.playback);
                }
                this.renderModalDeviceList();
                this.updateRemoteBanner();
                break;

            case 'REMOTE_STATE_UPDATE':
                if (msg.activeDeviceId !== this.deviceId) {
                    this.setActiveDevice(msg.activeDeviceId, msg.activeDeviceName);
                    this.remotePlayback = msg.playback || {
                        track: msg.track,
                        position: msg.position,
                        isPlaying: msg.isPlaying,
                        volume: msg.volume,
                    };
                    this.renderRemoteState(this.remotePlayback);
                    this.updateRemoteBanner();
                }
                break;

            case 'PAUSE_LOCAL':
                console.log('[Echos Connect] Playback transferred to another device. Pausing local player.');
                this.pauseLocalPlayer();
                this.isLocalActive = false;
                this.updateRemoteBanner();
                break;

            case 'TRANSFER_PLAYBACK':
                // Handles BroadcastChannel and peer transfer frames
                if (msg.targetDeviceId === this.deviceId) {
                    console.log('[Echos Connect] Received direct TRANSFER_PLAYBACK for this device.');
                    this.isLocalActive = true;
                    this.activeDeviceId = this.deviceId;
                    this.activeDeviceName = this.deviceName;
                    this.handleTransferToHere(msg);
                    this.updateRemoteBanner();
                    this.renderModalDeviceList();
                } else if (msg.fromDeviceId !== this.deviceId && this.isLocalActive) {
                    this.pauseLocalPlayer();
                    this.isLocalActive = false;
                    this.activeDeviceId = msg.targetDeviceId;
                    this.updateRemoteBanner();
                }
                break;

            case 'LOAD_AND_PLAY':
                console.log('[Echos Connect] Playback transferred to this device! Starting audio.');
                this.isLocalActive = true;
                this.activeDeviceId = this.deviceId;
                this.activeDeviceName = this.deviceName;
                this.handleTransferToHere(msg);
                this.updateRemoteBanner();
                this.renderModalDeviceList();
                break;

            case 'EXECUTE_COMMAND':
                if (this.isLocalActive) {
                    this.executePlayerCommand(msg.action, msg.payload);
                }
                break;
        }
    }

    setActiveDevice(deviceId, deviceName) {
        this.activeDeviceId = deviceId;
        if (deviceName) {
            this.activeDeviceName = deviceName;
        } else {
            const found = this.devices.find((d) => (d.id || d.deviceId) === deviceId);
            if (found) this.activeDeviceName = found.name || found.deviceName || 'Connected Device';
        }
        this.isLocalActive = this.activeDeviceId === this.deviceId;
    }

    /**
     * Handover playback to this device with exact track & timestamp
     */
    async handleTransferToHere(msg) {
        try {
            const player = Player.instance;
            if (!player) return;

            const { volume, queue, queueIndex } = msg || {};
            // Resolve track from msg.track, or fallback to msg.playback?.track or this.remotePlayback?.track
            const track = msg.track || msg.playback?.track || this.remotePlayback?.track || null;
            const rawPosition =
                typeof msg.position === 'number'
                    ? msg.position
                    : typeof msg.playback?.position === 'number'
                    ? msg.playback.position
                    : typeof this.remotePlayback?.position === 'number'
                    ? this.remotePlayback.position
                    : 0;
            const targetPosition = Number.isFinite(rawPosition) && rawPosition > 0 ? rawPosition : 0;

            console.log('[Echos Connect] handleTransferToHere resolving:', {
                trackTitle: track?.title,
                trackId: track?.id,
                targetPosition,
                hasQueue: Boolean(queue?.length),
            });

            if (typeof volume === 'number' && Number.isFinite(volume)) {
                player.setVolume(volume);
            }

            if (!track) {
                console.warn('[Echos Connect] No track provided in transfer payload.');
                return;
            }

            // Restore queue context if sent
            if (Array.isArray(queue) && queue.length > 0) {
                const qIdx =
                    typeof queueIndex === 'number' && queueIndex >= 0 && queueIndex < queue.length ? queueIndex : 0;
                await player.setQueue(queue, qIdx);
            } else if (!player.currentTrack || player.currentTrack.id !== track.id) {
                await player.setQueue([track], 0);
            }

            let playSuccess = false;

            // If current active track is already this track, seek and resume
            if (player.currentTrack && player.currentTrack.id === track.id && player.activeElement) {
                if (targetPosition > 0) {
                    if (typeof player.seekTo === 'function') {
                        await player.seekTo(targetPosition);
                    } else {
                        player.activeElement.currentTime = targetPosition;
                    }
                }
                playSuccess = await player.safePlay(player.activeElement);
            } else {
                await player.playTrackFromQueue(targetPosition);
                playSuccess = !player.autoplayBlocked && player.activeElement && !player.activeElement.paused;
            }

            // If browser blocked autoplay (common on Smart TVs / cold browser tabs),
            // show the one-touch prompt so user can tap anywhere or press remote OK button
            if (!playSuccess || player.autoplayBlocked) {
                this.showAutoplayPrompt(track, targetPosition, msg.sourceDeviceId || msg.fromDeviceId);
            }
        } catch (err) {
            console.error('[Echos Connect] Failed to resume playback on transfer:', err);
        }
    }

    /**
     * Show non-intrusive interactive prompt for un-clicked tabs/Smart TVs blocked by autoplay policy
     */
    showAutoplayPrompt(track, position = 0, sourceDeviceId = null) {
        let overlay = document.getElementById('connect-autoplay-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'connect-autoplay-overlay';
            overlay.className = 'connect-autoplay-overlay';
            document.body.appendChild(overlay);
        }

        const title = track?.title || 'Playback';
        const artist =
            track?.artist ||
            (track?.artists && track.artists[0]?.name) ||
            (Array.isArray(track?.artists) ? track.artists.map((a) => a.name).join(', ') : '');

        overlay.innerHTML = `
            <div class="connect-autoplay-card">
                <div class="autoplay-pulse-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                </div>
                <div class="autoplay-info">
                    <div class="autoplay-header">Playback Transferred</div>
                    <div class="autoplay-track-title">${title}</div>
                    ${artist ? `<div class="autoplay-track-artist">${artist}</div>` : ''}
                    <div class="autoplay-hint">Press OK on remote or tap anywhere to start listening</div>
                </div>
                <button type="button" class="btn-primary autoplay-resume-btn">Play Now</button>
            </div>
        `;

        overlay.style.display = 'flex';

        const resumePlayback = async (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            window.removeEventListener('click', resumePlayback, true);
            window.removeEventListener('keydown', resumePlayback, true);
            window.removeEventListener('touchstart', resumePlayback, true);

            overlay.style.display = 'none';

            const player = Player.instance;
            if (!player) return;

            try {
                const { audioContextManager } = await import('./audio-context.js');
                if (audioContextManager && !audioContextManager.isReady()) {
                    audioContextManager.init(player.activeElement);
                }
                if (audioContextManager) {
                    await audioContextManager.resume();
                }
            } catch (_) {}

            if (position > 0 && Math.abs((player.activeElement?.currentTime || 0) - position) > 2) {
                try {
                    await player.seekTo(position);
                } catch (_) {}
            }

            if (player.activeElement) {
                try {
                    await player.activeElement.play();
                    player.autoplayBlocked = false;
                } catch (playErr) {
                    console.error('[Echos Connect] Autoplay resume failed:', playErr);
                    await player.handlePlayPause();
                }
            }
        };

        const playBtn = overlay.querySelector('.autoplay-resume-btn');
        if (playBtn) {
            playBtn.addEventListener('click', resumePlayback);
        }

        setTimeout(() => {
            window.addEventListener('click', resumePlayback, true);
            window.addEventListener('keydown', resumePlayback, true);
            window.addEventListener('touchstart', resumePlayback, true);
        }, 50);
    }

    pauseLocalPlayer() {
        try {
            const player = Player.instance;
            if (player && player.activeElement && !player.activeElement.paused) {
                player.activeElement.pause();
            }
        } catch (_e) {}
    }

    executePlayerCommand(action, payload) {
        const player = Player.instance;
        if (!player) return;

        switch (action) {
            case 'PLAY':
                if (player.activeElement?.paused) player.handlePlayPause();
                break;
            case 'PAUSE':
                if (!player.activeElement?.paused) player.handlePlayPause();
                break;
            case 'NEXT':
                player.playNext();
                break;
            case 'PREV':
                player.playPrev();
                break;
            case 'SEEK':
                if (typeof payload?.position === 'number' && Number.isFinite(payload.position)) {
                    if (typeof player.seekTo === 'function') {
                        player.seekTo(payload.position);
                    } else if (player.activeElement) {
                        player.activeElement.currentTime = payload.position;
                    }
                }
                break;
            case 'VOLUME':
                if (typeof payload?.volume === 'number' && Number.isFinite(payload.volume)) {
                    player.setVolume(payload.volume);
                }
                break;
        }
    }

    /**
     * Send remote command to the currently active device
     */
    sendRemoteCommand(action, payload = {}) {
        this.send({
            type: 'REMOTE_COMMAND',
            action,
            payload,
        });
    }

    /**
     * Request to transfer playback to another device
     */
    async transferPlayback(targetDeviceId) {
        if (!targetDeviceId || targetDeviceId === 'undefined') return;
        if (targetDeviceId === this.activeDeviceId && !this.isLocalActive) return;

        const player = Player.instance;
        const currentTrack = serializeTrack(player?.currentTrack);
        const position = player?.activeElement?.currentTime || 0;
        const volume = player?.userVolume ?? 1;

        let serializedQueue = null;
        let queueIndex = 0;
        try {
            const rawQueue = player?.getCurrentQueue ? player.getCurrentQueue() : player?.queue || [];
            const curIdx = player?.currentQueueIndex >= 0 ? player.currentQueueIndex : 0;
            if (rawQueue && rawQueue.length > 0) {
                const start = Math.max(0, curIdx - 5);
                const end = Math.min(rawQueue.length, curIdx + 45);
                serializedQueue = rawQueue.slice(start, end).map(serializeTrack).filter(Boolean);
                queueIndex = curIdx - start;
            }
        } catch (_qErr) {}

        // Proactively emit state first so Cloudflare Durable Object updates its state
        if (currentTrack) {
            this.send({
                type: 'PLAYBACK_STATE',
                deviceId: this.deviceId,
                track: currentTrack,
                position,
                isPlaying: !player?.activeElement?.paused,
                volume,
            });
        }

        // Brief delay (120ms) to ensure Durable Object commits state before TRANSFER_PLAYBACK
        await new Promise((r) => setTimeout(r, 120));

        this.send({
            type: 'TRANSFER_PLAYBACK',
            targetDeviceId,
            fromDeviceId: this.deviceId,
            track: currentTrack,
            position,
            volume,
            queue: serializedQueue,
            queueIndex,
        });

        if (targetDeviceId === this.deviceId) {
            this.isLocalActive = true;
            this.activeDeviceId = this.deviceId;
            this.activeDeviceName = this.deviceName;
        } else {
            this.isLocalActive = false;
            this.activeDeviceId = targetDeviceId;
            const target = this.devices.find((d) => (d.id || d.deviceId) === targetDeviceId);
            if (target) this.activeDeviceName = target.name || target.deviceName || 'Connected Device';
        }
        this.updateRemoteBanner();
        this.renderModalDeviceList();
    }

    /**
     * Monitor player playback state to emit sync messages
     */
    setupPlayerListeners() {
        const emitState = () => {
            if (!this.isLocalActive) return;
            const player = Player.instance;
            if (!player || !player.activeElement) return;

            const audio = player.activeElement;
            const currentTrack = serializeTrack(player.currentTrack);
            if (!currentTrack) return;

            this.send({
                type: 'PLAYBACK_STATE',
                deviceId: this.deviceId,
                track: currentTrack,
                position: audio.currentTime || 0,
                isPlaying: !audio.paused,
                volume: player.userVolume,
            });
        };

        const attachElement = (el) => {
            if (!el) return;
            el.addEventListener('play', emitState);
            el.addEventListener('pause', emitState);
            el.addEventListener('seeked', emitState);
            el.addEventListener('timeupdate', () => {
                if (!this.isLocalActive) return;
                if (this.syncThrottleTimer) return;
                this.syncThrottleTimer = setTimeout(() => {
                    this.syncThrottleTimer = null;
                    emitState();
                }, 2500);
            });
        };

        const player = Player.instance;
        if (player) {
            if (player.audio) attachElement(player.audio);
            if (player.audioElements) {
                player.audioElements.forEach(attachElement);
            }
            if (player.video) attachElement(player.video);
        }

        window.addEventListener('player:play', emitState);
        window.addEventListener('player:pause', emitState);
        window.addEventListener('player:track-change', emitState);
    }

    /**
     * Mirror remote active device state on this client's player bar
     */
    renderRemoteState(playback) {
        if (!playback || this.isLocalActive) return;

        const trackTitle = document.querySelector('.now-playing-bar .title');
        const trackArtist = document.querySelector('.now-playing-bar .artist');
        const trackCover =
            document.querySelector('.now-playing-bar img.cover') ||
            document.querySelector('.now-playing-bar .cover-art img');
        const playPauseBtn = document.querySelector('.now-playing-bar .play-pause-btn');
        const currentTimeEl = document.getElementById('current-time');
        const progressFill = document.getElementById('progress-fill');

        if (playback.track) {
            if (trackTitle) trackTitle.textContent = playback.track.title || 'Unknown Title';
            if (trackArtist) {
                const artistName = typeof playback.track.artist === 'string'
                    ? playback.track.artist
                    : (playback.track.artist?.name || (Array.isArray(playback.track.artists) ? playback.track.artists.map(a => a?.name || a).join(', ') : 'Unknown Artist'));
                trackArtist.textContent = artistName;
            }
            if (trackCover && playback.track.cover) trackCover.src = playback.track.cover;
        }

        if (playPauseBtn) {
            playPauseBtn.classList.toggle('playing', playback.isPlaying);
        }

        if (currentTimeEl && typeof playback.position === 'number') {
            const mins = Math.floor(playback.position / 60);
            const secs = Math.floor(playback.position % 60)
                .toString()
                .padStart(2, '0');
            currentTimeEl.textContent = `${mins}:${secs}`;
        }

        if (progressFill && playback.track?.duration) {
            const percent = Math.min(100, (playback.position / playback.track.duration) * 100);
            progressFill.style.width = `${percent}%`;
        }
    }

    /**
     * Sets up UI elements (Devices Button, Spotify Connect Banner, Modal)
     */
    setupUI() {
        this.ensureBanner();
        this.ensureModal();
        this.bindEvents();
    }

    ensureBanner() {
        if (document.getElementById('remote-playback-banner')) return;

        const bar = document.querySelector('.now-playing-bar');
        if (!bar) return;

        const banner = document.createElement('div');
        banner.id = 'remote-playback-banner';
        banner.className = 'remote-playback-banner';
        banner.style.display = 'none';
        banner.innerHTML = `
            <div class="remote-banner-content">
                <span class="pulse-indicator"></span>
                <span class="device-icon-wrapper">
                    <svg class="lucide lucide-speaker" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect width="16" height="20" x="4" y="2" rx="2"></rect>
                        <circle cx="12" cy="14" r="4"></circle>
                        <line x1="12" x2="12.01" y1="6" y2="6"></line>
                    </svg>
                </span>
                <span>Listening on <strong id="remote-device-label">Connected Device</strong></span>
            </div>
            <button id="banner-switch-device-btn" class="banner-switch-btn">Switch</button>
        `;

        bar.parentNode.insertBefore(banner, bar);
        this.bannerEl = banner;

        banner.querySelector('#banner-switch-device-btn')?.addEventListener('click', () => {
            this.openModal();
        });
        banner.addEventListener('click', (e) => {
            if (e.target.id !== 'banner-switch-device-btn') {
                this.openModal();
            }
        });
    }

    updateRemoteBanner() {
        const banner = document.getElementById('remote-playback-banner') || this.bannerEl;
        const devicesBtn = document.getElementById('connected-devices-btn');
        if (!banner) return;

        if (!this.isLocalActive && this.activeDeviceId) {
            banner.style.display = 'flex';
            const label = banner.querySelector('#remote-device-label');
            if (label) label.textContent = this.activeDeviceName || 'Connected Device';
            devicesBtn?.classList.add('has-remote-active');
        } else {
            banner.style.display = 'none';
            devicesBtn?.classList.remove('has-remote-active');
        }
    }

    ensureModal() {
        if (this.modalEl) return this.modalEl;

        let el = document.getElementById('connected-devices-modal');
        if (!el) {
            el = document.createElement('div');
            el.id = 'connected-devices-modal';
            el.className = 'modal connected-devices-modal';
            el.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content" style="max-width: 440px; padding: 24px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div class="devices-header-icon" style="color: #1ed760;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"></path>
                                    <path d="M14 15v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2"></path>
                                    <path d="M6 18h4"></path>
                                    <path d="M12 18v3"></path>
                                </svg>
                            </div>
                            <h3 style="margin: 0; font-size: 1.25rem; font-weight: 700;">Connect to a device</h3>
                        </div>
                        <button type="button" id="close-devices-modal-btn" class="modal-close" style="background: none; border: none; color: #888; cursor: pointer; font-size: 20px;">✕</button>
                    </div>

                    <div style="color: #a0a0a0; font-size: 0.85rem; margin-bottom: 16px;">
                        Seamlessly switch playback between your TV, phone, tablet, and desktop without losing your spot.
                    </div>

                    <!-- Current Device Section -->
                    <div class="device-section-title">CURRENT DEVICE</div>
                    <div id="current-device-row" class="device-item active" style="margin-bottom: 16px;">
                        <div class="device-item-icon">
                            ${this.getDeviceSvg(this.deviceType)}
                        </div>
                        <div class="device-item-info">
                            <div class="device-item-name">${this.deviceName} (This Device)</div>
                            <div class="device-item-status" style="color: #1ed760;">
                                <span class="device-online-dot"></span>
                                ${this.isLocalActive ? 'Listening on this device' : 'Connected'}
                            </div>
                        </div>
                        ${
                            !this.isLocalActive
                                ? `<button class="btn-primary device-switch-btn" id="play-here-btn" style="padding: 6px 14px; font-size: 0.8rem;">Play Here</button>`
                                : `<span style="font-size: 0.8rem; color: #1ed760; font-weight: 600;">Active</span>`
                        }
                    </div>

                    <!-- Available Devices Section -->
                    <div class="device-section-title">AVAILABLE DEVICES</div>
                    <div id="remote-devices-list" class="modal-list" style="max-height: 220px; overflow-y: auto;">
                        <div style="color: #777; font-size: 0.85rem; padding: 12px; text-align: center;">Scanning for nearby devices...</div>
                    </div>

                    <div style="margin-top: 20px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 14px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.8rem; color: #777;">Don't see your TV?</span>
                        <button type="button" id="modal-pair-tv-btn" class="btn-secondary" style="font-size: 0.8rem; padding: 6px 12px;">Pair with QR Code</button>
                    </div>
                </div>
            `;
            document.body.appendChild(el);
        }

        if (!el.dataset.boundListeners) {
            el.dataset.boundListeners = 'true';
            const close = () => this.closeModal();

            el.querySelector('#close-devices-modal-btn')?.addEventListener('click', close);
            el.querySelector('.modal-overlay')?.addEventListener('click', close);
            el.addEventListener('click', (e) => {
                if (e.target === el) close();
            });
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && el.classList.contains('active')) close();
            });

            el.querySelector('#modal-pair-tv-btn')?.addEventListener('click', async () => {
                this.closeModal();
                const { devicePairing } = await import('./accounts/devicePairing.js');
                devicePairing.open();
            });
        }

        this.modalEl = el;
        return el;
    }

    getDeviceSvg(type) {
        if (type === 'tv') {
            return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="7" rx="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>`;
        }
        if (type === 'mobile') {
            return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><line x1="12" x2="12.01" y1="18" y2="18"></line></svg>`;
        }
        if (type === 'tablet') {
            return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="20" x="3" y="2" rx="2"></rect><line x1="12" x2="12.01" y1="18" y2="18"></line></svg>`;
        }
        return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="12" x="3" y="4" rx="2"></rect><line x1="2" x2="22" y1="20" y2="20"></line></svg>`;
    }

    renderModalDeviceList() {
        const modal = document.getElementById('connected-devices-modal') || this.modalEl;
        if (!modal) return;

        // Update Current Device block
        const currentContainer = modal.querySelector('#current-device-row');
        if (currentContainer) {
            currentContainer.innerHTML = `
                <div class="device-item-icon">
                    ${this.getDeviceSvg(this.deviceType)}
                </div>
                <div class="device-item-info">
                    <div class="device-item-name">${this.deviceName} (This Device)</div>
                    <div class="device-item-status" style="color: ${this.isLocalActive ? '#1ed760' : '#888'};">
                        <span class="device-online-dot ${this.isLocalActive ? 'pulse' : ''}"></span>
                        ${this.isLocalActive ? 'Listening on this device' : 'Connected'}
                    </div>
                </div>
                ${
                    !this.isLocalActive
                        ? `<button class="btn-primary device-switch-btn" id="play-here-btn" style="padding: 6px 14px; font-size: 0.8rem;">Play Here</button>`
                        : `<span style="font-size: 0.8rem; color: #1ed760; font-weight: 600;">Active</span>`
                }
            `;
            currentContainer.querySelector('#play-here-btn')?.addEventListener('click', () => {
                this.transferPlayback(this.deviceId);
            });
        }

        // Update Remote Devices list
        const listEl = modal.querySelector('#remote-devices-list');
        if (!listEl) return;

        const otherDevices = this.devices.filter((d) => {
            const devId = d.id || d.deviceId;
            return devId && devId !== this.deviceId;
        });

        if (otherDevices.length === 0) {
            listEl.innerHTML = `
                <div style="color: #777; font-size: 0.85rem; padding: 18px 12px; text-align: center;">
                    No other devices detected.<br>
                    <span style="font-size: 0.75rem; color: #555;">Open Echoes on your TV, phone, or tablet to switch instantly.</span>
                </div>
            `;
            return;
        }

        listEl.innerHTML = otherDevices
            .map((dev) => {
                const devId = dev.id || dev.deviceId;
                const devName = dev.name || dev.deviceName || 'Unknown Device';
                const devType = dev.type || dev.deviceType || 'desktop';
                const isThisActive = devId === this.activeDeviceId;
                return `
                    <div class="device-item ${isThisActive ? 'active' : ''}" data-device-id="${devId}">
                        <div class="device-item-icon">
                            ${this.getDeviceSvg(devType)}
                        </div>
                        <div class="device-item-info">
                            <div class="device-item-name" style="${isThisActive ? 'color: #1ed760;' : ''}">${devName}</div>
                            <div class="device-item-status" style="${isThisActive ? 'color: #1ed760;' : ''}">
                                <span class="device-online-dot ${isThisActive ? 'pulse' : ''}"></span>
                                ${isThisActive ? 'Playing right now' : 'Online'}
                            </div>
                        </div>
                        ${
                            isThisActive
                                ? `<span style="font-size: 0.8rem; color: #1ed760; font-weight: 600;">Active</span>`
                                : `<button class="btn-secondary device-switch-btn" data-target="${devId}" style="padding: 6px 14px; font-size: 0.8rem;">Transfer</button>`
                        }
                    </div>
                `;
            })
            .join('');

        listEl.querySelectorAll('.device-switch-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetId = btn.getAttribute('data-target');
                if (targetId) this.transferPlayback(targetId);
            });
        });

        listEl.querySelectorAll('.device-item').forEach((row) => {
            row.addEventListener('click', () => {
                const targetId = row.getAttribute('data-device-id');
                if (targetId) this.transferPlayback(targetId);
            });
        });
    }

    openModal() {
        const modal = this.ensureModal();
        this.renderModalDeviceList();
        modal.classList.add('active');
    }

    closeModal() {
        const modal = document.getElementById('connected-devices-modal');
        if (modal) modal.classList.remove('active');
    }

    bindEvents() {
        const btn = document.getElementById('connected-devices-btn');
        if (btn) {
            btn.addEventListener('click', () => this.openModal());
        }
    }
}

export const connectManager = ConnectManager.instance;
