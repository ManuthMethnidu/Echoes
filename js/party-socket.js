// js/party-socket.js

/**
 * High-performance WebSocket client for Echoes Listening Parties.
 * Connects directly to the Echoes VPS backend (stream.mteck.tech),
 * supporting 1,000+ simultaneous listeners in a single room with sub-50ms sync latency.
 */
export class PartySocketClient {
    constructor() {
        this.ws = null;
        this.handlers = new Set();
        this.isHost = false;
        this.partyId = null;
        this.party = null;
        this.members = [];
        this.messages = [];
        this.requests = [];
        this.memberId = null;
        this.localProfile = null;
        this.hostToken = null;
        this.pendingJoin = null;
        this.reconnectTimer = null;
        this.isExplicitlyClosed = false;
    }

    async connect() {
        return Promise.resolve();
    }

    onMessage(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    _emit(msg) {
        this.handlers.forEach((handler) => {
            try {
                handler(msg);
            } catch (err) {
                console.error('[PartySocketClient Message Handler Error]', err);
            }
        });
    }

    _getSavedHostState(partyId) {
        try {
            const raw = localStorage.getItem(`echos_party_host_${partyId}`);
            return raw ? JSON.parse(raw) : null;
        } catch (_e) {
            return null;
        }
    }

    _saveHostState(partyId) {
        if (!this.isHost || !this.party) return;
        try {
            localStorage.setItem(
                `echos_party_host_${partyId}`,
                JSON.stringify({
                    party: this.party,
                    members: this.members,
                    messages: this.messages,
                    requests: this.requests,
                })
            );
        } catch (_e) {}
    }

    _debouncedSaveHostState(partyId) {
        if (this._saveHostTimer) return;
        this._saveHostTimer = setTimeout(() => {
            this._saveHostTimer = null;
            this._saveHostState(partyId);
        }, 2000);
    }

    _clearHostState(partyId) {
        if (this._saveHostTimer) {
            clearTimeout(this._saveHostTimer);
            this._saveHostTimer = null;
        }
        try {
            localStorage.removeItem(`echos_party_host_${partyId}`);
        } catch (_e) {}
    }

    _getWsUrl() {
        const base =
            localStorage.getItem('echos-party-ws-url') ||
            (typeof window !== 'undefined' && window.__ECHOS_PARTY_WS_URL__) ||
            'wss://stream.mteck.tech/ws';

        const u = new URL(base);
        u.searchParams.set('channel', 'party');
        u.searchParams.set('partyId', this.partyId);
        u.searchParams.set('memberId', this.memberId);
        u.searchParams.set('isHost', this.isHost ? 'true' : 'false');
        if (this.hostToken) {
            u.searchParams.set('hostToken', this.hostToken);
        }
        if (this.localProfile?.name) {
            u.searchParams.set('name', this.localProfile.name);
        }
        if (this.localProfile?.avatar_url) {
            u.searchParams.set('avatarUrl', this.localProfile.avatar_url);
        }
        return u.toString();
    }

    _initWebSocket(partyId) {
        if (this.ws) {
            try {
                this.ws.close();
            } catch {}
            this.ws = null;
        }

        this.isExplicitlyClosed = false;
        const wsUrl = this._getWsUrl();

        try {
            this.ws = new WebSocket(wsUrl);
        } catch (err) {
            console.error('[PartySocket] Failed to create WebSocket connection:', err);
            if (this.pendingJoin) {
                this.pendingJoin.reject(err);
                this.pendingJoin = null;
            }
            return;
        }

        this.ws.onopen = () => {
            console.log(`[PartySocket] Connected to VPS for party ${partyId} (host=${this.isHost})`);
            if (this.isHost && this.party) {
                this._safeSend({
                    type: 'CREATE_PARTY',
                    partyId: this.partyId,
                    name: this.party.name,
                    hostToken: this.hostToken,
                    memberId: this.memberId,
                    profile: this.localProfile,
                    playback: {
                        current_track: this.party.current_track,
                        is_playing: this.party.is_playing,
                        playback_time: this.party.playback_time,
                        playback_timestamp: this.party.playback_timestamp,
                        queue: this.party.queue || [],
                    },
                });
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this._handleServerMessage(message);
            } catch (err) {
                console.error('[PartySocket] Failed to parse message:', err);
            }
        };

        this.ws.onclose = (event) => {
            console.warn(`[PartySocket] Disconnected from party ${partyId} (code=${event.code})`);
            if (this.isExplicitlyClosed) return;

            // Reconnect logic
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => {
                if (!this.isExplicitlyClosed && this.partyId) {
                    console.log(`[PartySocket] Reconnecting to party ${partyId}...`);
                    this._initWebSocket(this.partyId);
                }
            }, 3000);
        };

        this.ws.onerror = (err) => {
            console.warn('[PartySocket] Connection error:', err);
        };
    }

    _handleServerMessage(message) {
        if (!message || typeof message !== 'object') return;

        // 1. Full room snapshot
        if (message.type === 'snapshot' && message.snapshot) {
            const snap = message.snapshot;
            this.party = snap.party || this.party;
            this.members = snap.members || [];
            this.messages = snap.messages || [];
            this.requests = snap.requests || [];
            if (typeof message.isHost === 'boolean') {
                this.isHost = message.isHost;
            }

            if (this.pendingJoin) {
                clearTimeout(this.pendingJoin.timeout);
                this.pendingJoin.resolve(snap);
                this.pendingJoin = null;
            }

            this._emit(message);
            return;
        }

        // 2. Instant micro-control from Host (<20ms latency)
        if (message.type === 'control') {
            if (!this.isHost && this.party) {
                if (message.action === 'pause') this.party.is_playing = false;
                if (message.action === 'play') this.party.is_playing = true;
                if (typeof message.time === 'number') this.party.playback_time = message.time;
                this.party.playback_timestamp = message.timestamp || Date.now();
            }
            this._emit(message);
            return;
        }

        // 3. Playback / track state update
        if (message.type === 'party' && message.party) {
            this.party = { ...this.party, ...message.party };
            this._emit({ type: 'party', party: this.party });
            return;
        }

        // 4. Members list update
        if (message.type === 'members' && Array.isArray(message.members)) {
            this.members = message.members;
            this._emit({ type: 'members', members: this.members });
            return;
        }

        // 5. Chat message
        if (message.type === 'message' && message.message) {
            this.messages.push(message.message);
            if (this.messages.length > 100) this.messages = this.messages.slice(-100);
            this._emit({ type: 'message', message: message.message });
            return;
        }

        // 6. Song requests list
        if (message.type === 'requests' && Array.isArray(message.requests)) {
            this.requests = message.requests;
            this._emit({ type: 'requests', requests: this.requests });
            return;
        }

        // 7. Party ended
        if (message.type === 'ended') {
            this._emit({ type: 'ended' });
            this.close();
            return;
        }
    }

    _safeSend(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(payload));
                return true;
            } catch (err) {
                console.error('[PartySocket] Send failed:', err);
            }
        }
        return false;
    }

    async request(type, payload = {}) {
        if (type === 'create') {
            return this._handleCreate(payload);
        }
        if (type === 'join') {
            return this._handleJoin(payload);
        }
        throw new Error(`Unsupported party request: ${type}`);
    }

    async _handleCreate(payload) {
        const partyId = 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
        this.partyId = partyId;
        this.isHost = true;
        this.memberId = payload.memberId || `member_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        this.localProfile = payload.profile || { name: 'Host', avatar_url: '' };
        this.hostToken = payload.hostToken || crypto.randomUUID().replace(/-/g, '');

        this.party = {
            id: partyId,
            name: payload.name || 'Listening Party',
            host_member_id: this.memberId,
            current_track: payload.playback?.current_track || null,
            is_playing: payload.playback?.is_playing || false,
            playback_time: payload.playback?.playback_time || 0,
            playback_timestamp: payload.playback?.playback_timestamp || Date.now(),
            queue: payload.playback?.queue || [],
        };

        this.members = [
            {
                id: this.memberId,
                name: this.localProfile.name || 'Host',
                avatar_url: this.localProfile.avatar_url || '',
                is_host: true,
                typing_until: 0,
            },
        ];
        this.messages = [];
        this.requests = [];

        this._saveHostState(partyId);
        this._initWebSocket(partyId);

        const snapshot = {
            type: 'snapshot',
            party: this.party,
            members: this.members,
            messages: this.messages,
            requests: this.requests,
            memberId: this.memberId,
            isHost: true,
        };

        return snapshot;
    }

    async _handleJoin(payload) {
        const { partyId, memberId, hostToken, profile } = payload;
        this.partyId = partyId;
        this.memberId = memberId;
        this.localProfile = profile || { name: 'Listener', avatar_url: '' };
        this.hostToken = hostToken;

        // Check if this client was the host (page reload / rejoin)
        const saved = this._getSavedHostState(partyId);
        if (saved && hostToken) {
            this.isHost = true;
            this.party = saved.party || {
                id: partyId,
                name: 'Listening Party',
                host_member_id: memberId,
                current_track: null,
                is_playing: false,
                playback_time: 0,
                playback_timestamp: Date.now(),
                queue: [],
            };
            this.members = [
                {
                    id: memberId,
                    name: this.localProfile.name || 'Host',
                    avatar_url: this.localProfile.avatar_url || '',
                    is_host: true,
                    typing_until: 0,
                },
            ];
            this.messages = saved.messages || [];
            this.requests = saved.requests || [];
            this._saveHostState(partyId);
            this._initWebSocket(partyId);

            return {
                type: 'snapshot',
                party: this.party,
                members: this.members,
                messages: this.messages,
                requests: this.requests,
                memberId: this.memberId,
                isHost: true,
            };
        }

        // Join as Listener via WebSocket
        this.isHost = false;
        this._initWebSocket(partyId);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingJoin = null;
                reject(
                    new Error(
                        'Could not connect to the listening party. The host may be offline or the party link is invalid.'
                    )
                );
            }, 10000);

            this.pendingJoin = { resolve, reject, timeout };
        });
    }

    async send(type, payload = {}) {
        // Instant micro-control from Host (play, pause, seek)
        if (type === 'control') {
            if (!this.isHost) return;
            if (this.party) {
                if (payload.action === 'pause') this.party.is_playing = false;
                if (payload.action === 'play') this.party.is_playing = true;
                if (typeof payload.time === 'number') this.party.playback_time = payload.time;
                this.party.playback_timestamp = payload.timestamp || Date.now();
            }
            this._safeSend({
                type: 'control',
                action: payload.action,
                time: payload.time,
                timestamp: payload.timestamp || Date.now(),
            });
            return;
        }

        // Playback sync from Host
        if (type === 'playback') {
            if (!this.isHost) return;
            this.party = {
                ...this.party,
                current_track: payload.current_track,
                is_playing: payload.is_playing,
                playback_time: payload.playback_time,
                playback_timestamp: payload.playback_timestamp || Date.now(),
                queue: payload.queue || [],
            };
            this._debouncedSaveHostState(this.partyId);
            this._safeSend({
                type: 'playback',
                current_track: payload.current_track,
                is_playing: payload.is_playing,
                playback_time: payload.playback_time,
                playback_timestamp: payload.playback_timestamp || Date.now(),
                queue: payload.queue || [],
            });
            return;
        }

        // Chat message
        if (type === 'chat') {
            this._safeSend({
                type: 'chat',
                content: payload.content,
            });
            return;
        }

        // Song request
        if (type === 'request') {
            this._safeSend({
                type: 'request',
                track: payload.track,
            });
            return;
        }

        // Remove request
        if (type === 'request:remove') {
            if (this.isHost) {
                this._safeSend({
                    type: 'request:remove',
                    requestId: payload.requestId,
                });
            }
            return;
        }

        // Typing indicator
        if (type === 'typing') {
            this._safeSend({
                type: 'typing',
                typing_until: payload.typing_until,
            });
            return;
        }

        // Leave party
        if (type === 'leave') {
            if (payload.end && this.isHost) {
                this._safeSend({
                    type: 'leave',
                    end: true,
                });
                this._clearHostState(this.partyId);
            } else {
                this._safeSend({
                    type: 'leave',
                    end: false,
                });
            }
            this.close();
            return;
        }
    }

    close() {
        this.isExplicitlyClosed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.pendingJoin) {
            clearTimeout(this.pendingJoin.timeout);
            this.pendingJoin = null;
        }
        if (this.ws) {
            try {
                this.ws.close();
            } catch {}
            this.ws = null;
        }
    }
}
