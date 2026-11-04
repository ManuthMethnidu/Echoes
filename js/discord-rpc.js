// js/discord-rpc.js - Discord Rich Presence Integration (arRPC, Local WebSocket, Tauri, and Webhook)

const STORAGE_KEYS = {
    ENABLED: 'discord-rpc-enabled',
    URL: 'discord-rpc-url',
    TYPE: 'discord-rpc-type', // 'arrpc' | 'http' | 'webhook'
    BUTTONS: 'discord-rpc-buttons',
    WEBHOOK_URL: 'discord-rpc-webhook-url',
};

class DiscordRPCManager {
    constructor() {
        this.enabled = localStorage.getItem(STORAGE_KEYS.ENABLED) === 'true';
        this.url = localStorage.getItem(STORAGE_KEYS.URL) || 'ws://127.0.0.1:1337';
        this.type = localStorage.getItem(STORAGE_KEYS.TYPE) || 'arrpc';
        this.showButtons = localStorage.getItem(STORAGE_KEYS.BUTTONS) !== 'false';
        this.webhookUrl = localStorage.getItem(STORAGE_KEYS.WEBHOOK_URL) || '';

        this.socket = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.lastTrack = null;
        this.player = null;
        this._updateThrottleTimer = null;
    }

    init(player) {
        this.player = player;

        if (this.enabled) {
            this.connect();
        }

        // Global player listeners
        window.addEventListener('player:track-change', (e) => {
            if (!this.enabled) return;
            const track = e.detail?.track || this.player?.currentTrack;
            this.updatePresence(track, true);
        });

        window.addEventListener('player:play', () => {
            if (!this.enabled) return;
            const track = this.player?.currentTrack;
            if (track) this.updatePresence(track, true);
        });

        window.addEventListener('player:pause', () => {
            if (!this.enabled) return;
            const track = this.player?.currentTrack;
            if (track) this.updatePresence(track, false);
        });

        window.addEventListener('beforeunload', () => {
            this.clearPresence();
        });
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        localStorage.setItem(STORAGE_KEYS.ENABLED, this.enabled ? 'true' : 'false');
        if (this.enabled) {
            this.connect();
            if (this.player?.currentTrack) {
                const isPlaying = this.player.activeElement ? !this.player.activeElement.paused : false;
                this.updatePresence(this.player.currentTrack, isPlaying);
            }
        } else {
            this.clearPresence();
            this.disconnect();
        }
        this._notifyStatus();
    }

    setUrl(url) {
        this.url = url || 'ws://127.0.0.1:1337';
        localStorage.setItem(STORAGE_KEYS.URL, this.url);
        if (this.enabled) {
            this.disconnect();
            this.connect();
        }
    }

    setType(type) {
        this.type = type || 'arrpc';
        localStorage.setItem(STORAGE_KEYS.TYPE, this.type);
        if (this.enabled) {
            this.disconnect();
            this.connect();
        }
    }

    setShowButtons(enabled) {
        this.showButtons = !!enabled;
        localStorage.setItem(STORAGE_KEYS.BUTTONS, this.showButtons ? 'true' : 'false');
        if (this.enabled && this.player?.currentTrack) {
            const isPlaying = this.player.activeElement ? !this.player.activeElement.paused : false;
            this.updatePresence(this.player.currentTrack, isPlaying);
        }
    }

    setWebhookUrl(url) {
        this.webhookUrl = url || '';
        localStorage.setItem(STORAGE_KEYS.WEBHOOK_URL, this.webhookUrl);
    }

    async testConnection() {
        if (this.type === 'webhook') {
            if (!this.webhookUrl) return { success: false, message: 'Please enter a webhook URL first.' };
            try {
                const res = await fetch(this.webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: '🔔 **Echoes Discord RPC Test** - Webhook connected successfully!',
                    }),
                });
                return {
                    success: res.ok,
                    message: res.ok ? 'Webhook test message sent successfully!' : `Webhook test failed: HTTP ${res.status}`,
                };
            } catch (err) {
                return { success: false, message: `Webhook test error: ${err.message}` };
            }
        }

        if (window.__TAURI__?.core?.invoke) {
            return { success: true, message: 'Connected to Tauri Native Discord IPC!' };
        }

        return new Promise((resolve) => {
            const targetUrl = this.url.startsWith('http') ? this.url.replace(/^http/, 'ws') : this.url;
            let finished = false;
            let ws;
            const timer = setTimeout(() => {
                if (!finished) {
                    finished = true;
                    if (ws) {
                        try {
                            ws.close();
                        } catch {}
                    }
                    resolve({
                        success: false,
                        message: `Connection timed out to ${targetUrl}. Is arRPC / Discord running on your device?`,
                    });
                }
            }, 3500);

            try {
                ws = new WebSocket(targetUrl);
                ws.onopen = () => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timer);
                        try {
                            ws.close();
                        } catch {}
                        resolve({
                            success: true,
                            message: `Successfully connected to Discord bridge at ${targetUrl}!`,
                        });
                    }
                };
                ws.onerror = () => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timer);
                        resolve({
                            success: false,
                            message: `Could not connect to ${targetUrl}. Please check that your arRPC bridge or Discord app is running.`,
                        });
                    }
                };
            } catch (err) {
                if (!finished) {
                    finished = true;
                    clearTimeout(timer);
                    resolve({ success: false, message: `Connection error: ${err.message}` });
                }
            }
        });
    }

    connect() {
        if (!this.enabled) return;
        if (this.type === 'webhook') {
            this.isConnected = !!this.webhookUrl;
            this._notifyStatus();
            return;
        }

        // Check if Tauri desktop app
        if (window.__TAURI__?.core?.invoke) {
            this.isConnected = true;
            this._notifyStatus();
            return;
        }

        // arRPC / WebSocket bridge
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            const targetUrl = this.url.startsWith('http') ? this.url.replace(/^http/, 'ws') : this.url;
            this.socket = new WebSocket(targetUrl);

            this.socket.onopen = () => {
                this.isConnected = true;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                this._notifyStatus();
                if (this.player?.currentTrack) {
                    const isPlaying = this.player.activeElement ? !this.player.activeElement.paused : false;
                    this.updatePresence(this.player.currentTrack, isPlaying);
                }
            };

            this.socket.onclose = () => {
                this.isConnected = false;
                this.socket = null;
                this._notifyStatus();
                this._scheduleReconnect();
            };

            this.socket.onerror = () => {
                this.isConnected = false;
                this._notifyStatus();
            };
        } catch (e) {
            console.warn('[DiscordRPC] Connection error:', e);
            this.isConnected = false;
            this._scheduleReconnect();
            this._notifyStatus();
        }
    }

    _scheduleReconnect() {
        if (!this.enabled || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.enabled) this.connect();
        }, 12000);
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            try {
                this.socket.close();
            } catch {}
            this.socket = null;
        }
        this.isConnected = false;
        this._notifyStatus();
    }

    async updatePresence(track, isPlaying = true) {
        if (!this.enabled || !track) return;

        // Throttle updates to at most once per 2 seconds
        if (this._updateThrottleTimer) {
            clearTimeout(this._updateThrottleTimer);
        }
        this._updateThrottleTimer = setTimeout(() => {
            this._doUpdatePresence(track, isPlaying);
        }, 300);
    }

    async _doUpdatePresence(track, isPlaying) {
        this.lastTrack = track;
        const audio = this.player?.activeElement || document.querySelector('audio');
        const currentTime = audio ? Math.floor(audio.currentTime || 0) : 0;
        const duration = audio ? Math.floor(audio.duration || (track.duration ? track.duration / 1000 : 0)) : 0;

        const artistName = track.artist?.name || (track.artists && track.artists.map((a) => a.name).join(', ')) || 'Unknown Artist';
        const title = track.title || 'Unknown Track';
        const albumName = track.album?.name || track.album?.title || 'Echoes';
        const cover = track.cover || 'https://echoes.mteck.tech/images/echoes_logo.png';

        const activity = {
            type: 2, // Listening
            name: 'Echoes',
            details: title.length > 120 ? title.substring(0, 117) + '...' : title,
            state: `by ${artistName}`.length > 120 ? `by ${artistName}`.substring(0, 117) + '...' : `by ${artistName}`,
            assets: {
                large_image: cover,
                large_text: albumName,
                small_image: isPlaying ? 'https://echoes.mteck.tech/images/play.svg' : 'https://echoes.mteck.tech/images/pause.svg',
                small_text: isPlaying ? 'Playing' : 'Paused',
            },
        };

        if (isPlaying && duration > 0) {
            activity.timestamps = {
                start: Math.floor(Date.now() - currentTime * 1000),
                end: Math.floor(Date.now() + (duration - currentTime) * 1000),
            };
        }

        if (this.showButtons && track.id) {
            activity.buttons = [
                {
                    label: 'Listen on Echoes',
                    url: `https://echoes.mteck.tech/track/${encodeURIComponent(track.id)}`,
                },
            ];
        }

        // 1. Tauri Native IPC
        if (window.__TAURI__?.core?.invoke) {
            try {
                await window.__TAURI__.core.invoke('discord_update_song', {
                    title,
                    artist: artistName,
                    artwork: cover,
                    position: currentTime,
                    duration,
                    playing: isPlaying,
                });
                return;
            } catch (e) {
                console.warn('[DiscordRPC] Tauri invoke error:', e);
            }
        }

        // 2. arRPC WebSocket
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(
                    JSON.stringify({
                        cmd: 'SET_ACTIVITY',
                        args: {
                            pid: 1000,
                            activity,
                        },
                        nonce: String(Date.now()),
                    })
                );
                return;
            } catch (e) {
                console.warn('[DiscordRPC] WebSocket send error:', e);
            }
        }

        // 3. HTTP Local Bridge Fallback
        if (this.url.startsWith('http') || !this.isConnected) {
            try {
                const httpUrl = this.url.startsWith('ws') ? this.url.replace(/^ws/, 'http') : this.url;
                await fetch(`${httpUrl.replace(/\/+$/, '')}/set_activity`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ activity }),
                    mode: 'cors',
                });
            } catch {}
        }

        // 4. Discord Webhook
        if (this.type === 'webhook' && this.webhookUrl) {
            this._sendWebhook(track, isPlaying, artistName, title, albumName, cover);
        }
    }

    async _sendWebhook(track, isPlaying, artist, title, album, cover) {
        if (!this.webhookUrl) return;
        try {
            await fetch(this.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: 'Echoes Now Playing',
                    avatar_url: 'https://echoes.mteck.tech/images/echoes_logo.png',
                    embeds: [
                        {
                            title: `${isPlaying ? '▶️ Now Playing' : '⏸️ Paused'}: ${title}`,
                            description: `**Artist:** ${artist}\n**Album:** ${album}`,
                            url: track.id ? `https://echoes.mteck.tech/track/${encodeURIComponent(track.id)}` : undefined,
                            color: isPlaying ? 0x38bdf8 : 0x71717a,
                            thumbnail: { url: cover },
                            footer: { text: 'Echoes Music Player &bull; Discord RPC' },
                            timestamp: new Date().toISOString(),
                        },
                    ],
                }),
            });
        } catch (e) {
            console.warn('[DiscordRPC] Webhook error:', e);
        }
    }

    clearPresence() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(
                    JSON.stringify({
                        cmd: 'SET_ACTIVITY',
                        args: { pid: 1000, activity: null },
                        nonce: String(Date.now()),
                    })
                );
            } catch {}
        }
    }

    _notifyStatus() {
        window.dispatchEvent(
            new CustomEvent('discord-rpc:status', {
                detail: {
                    enabled: this.enabled,
                    connected: this.isConnected,
                    url: this.url,
                    type: this.type,
                },
            })
        );
    }
}

export const discordRPC = new DiscordRPCManager();
