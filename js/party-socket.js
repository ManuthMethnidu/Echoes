import { joinRoom, selfId, defaultRelayUrls } from '@trystero-p2p/nostr';

// Extended relay list with reliable public Nostr relays for high-speed WebRTC peer discovery
const RELAY_URLS = Array.from(
    new Set([
        ...defaultRelayUrls,
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.snort.social',
        'wss://relay.primal.net',
        'wss://nostr.mom',
        'wss://nostr.wine',
        'wss://relay.nostr.band',
    ])
);

export class PartySocketClient {
    constructor() {
        this.room = null;
        this.actionMsg = null;
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
        this.joinRetryTimer = null;
        this.knownPeers = new Set();
    }

    async connect() {
        // In P2P, connection is established upon join/create room.
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
                console.error('[P2P Party Message Handler Error]', err);
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

    _clearHostState(partyId) {
        try {
            localStorage.removeItem(`echos_party_host_${partyId}`);
        } catch (_e) {}
    }

    async request(type, payload = {}) {
        if (type === 'create') {
            return this._handleCreate(payload);
        }
        if (type === 'join') {
            return this._handleJoin(payload);
        }
        throw new Error(`Unsupported P2P party request: ${type}`);
    }

    async _handleCreate(payload) {
        const partyId = 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
        this.partyId = partyId;
        this.isHost = true;
        this.memberId = payload.memberId || `member_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        this.localProfile = payload.profile || { name: 'Host', avatar_url: '' };
        this.hostToken = payload.hostToken;

        this.party = {
            id: partyId,
            name: payload.name || 'Listening Party',
            host_member_id: this.memberId,
            host_peer_id: selfId,
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
                peer_id: selfId,
                typing_until: 0,
            },
        ];
        this.messages = [];
        this.requests = [];

        this._saveHostState(partyId);
        this._initP2PRoom(partyId);

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

        // Check if this client was the host of this party (page reload / rejoin)
        const saved = this._getSavedHostState(partyId);
        if (saved && hostToken) {
            this.isHost = true;
            this.party = saved.party || {
                id: partyId,
                name: 'Listening Party',
                host_member_id: memberId,
                host_peer_id: selfId,
                current_track: null,
                is_playing: false,
                playback_time: 0,
                playback_timestamp: Date.now(),
                queue: [],
            };
            this.party.host_peer_id = selfId;
            this.members = [
                {
                    id: memberId,
                    name: this.localProfile.name || 'Host',
                    avatar_url: this.localProfile.avatar_url || '',
                    is_host: true,
                    peer_id: selfId,
                    typing_until: 0,
                },
            ];
            this.messages = saved.messages || [];
            this.requests = saved.requests || [];
            this._saveHostState(partyId);
            this._initP2PRoom(partyId);

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

        // Otherwise, join as Guest and request snapshot from the Host
        this.isHost = false;
        this._initP2PRoom(partyId);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
                this.joinRetryTimer = null;
                this.pendingJoin = null;
                reject(
                    new Error(
                        'Could not connect to the party host. The host may be offline or the party link is invalid.'
                    )
                );
            }, 16000);

            this.pendingJoin = { resolve, reject, timeout };

            const broadcastAnnounce = () => {
                if (!this.pendingJoin || !this.actionMsg) return;
                this.actionMsg
                    .send({
                        type: 'announce',
                        memberId: this.memberId,
                        profile: this.localProfile,
                        hostToken: this.hostToken || null,
                    })
                    .catch(() => {});
            };

            // Send announce immediately and periodically until host responds with snapshot
            broadcastAnnounce();
            this.joinRetryTimer = setInterval(broadcastAnnounce, 2500);
        });
    }

    _initP2PRoom(partyId) {
        if (this.room) {
            try {
                this.room.leave();
            } catch (_e) {}
        }

        this.knownPeers.clear();
        this.room = joinRoom(
            {
                appId: 'echos-music-party',
                relayUrls: RELAY_URLS,
            },
            partyId
        );

        this.actionMsg = this.room.makeAction('msg');
        this.actionMsg.onMessage = (data, context) => this._onPeerMessage(data, context);

        this.room.onPeerJoin = (peerId) => this._onPeerJoin(peerId);
        this.room.onPeerLeave = (peerId) => this._onPeerLeave(peerId);
    }

    _onPeerJoin(peerId) {
        this.knownPeers.add(peerId);

        if (this.isHost && this.party) {
            // Proactively notify new peer of host presence
            this.actionMsg
                .send(
                    {
                        type: 'host_presence',
                        hostPeerId: selfId,
                        party: this.party,
                    },
                    { target: peerId }
                )
                .catch(() => {});
        } else if (this.pendingJoin) {
            // If waiting for snapshot, send announce directly to new peer
            this.actionMsg
                .send(
                    {
                        type: 'announce',
                        memberId: this.memberId,
                        profile: this.localProfile,
                        hostToken: this.hostToken || null,
                    },
                    { target: peerId }
                )
                .catch(() => {});
        }
    }

    _onPeerLeave(peerId) {
        this.knownPeers.delete(peerId);

        // If Guest and Host left:
        if (!this.isHost && this.party?.host_peer_id === peerId) {
            this._emit({ type: 'ended' });
            return;
        }

        // If Host and Guest left:
        if (this.isHost) {
            const initialCount = this.members.length;
            this.members = this.members.filter((m) => m.peer_id !== peerId);
            if (this.members.length !== initialCount) {
                this._saveHostState(this.partyId);
                this.actionMsg.send({ type: 'members', members: this.members }).catch(() => {});
                this._emit({ type: 'members', members: this.members });
            }
        }
    }

    _onPeerMessage(message, context) {
        if (!message || typeof message !== 'object') return;
        const peerId = context.peerId;

        // 1. Announce from joining peer
        if (message.type === 'announce') {
            if (this.isHost) {
                const guestMemberId = message.memberId;
                const guestProfile = message.profile || {};

                // Update or add member
                const existingIndex = this.members.findIndex((m) => m.id === guestMemberId);
                const memberData = {
                    id: guestMemberId,
                    name: guestProfile.name || 'Listener',
                    avatar_url: guestProfile.avatar_url || '',
                    is_host: false,
                    peer_id: peerId,
                    typing_until: 0,
                };

                if (existingIndex >= 0) {
                    this.members[existingIndex] = memberData;
                } else {
                    this.members.push(memberData);
                }

                this._saveHostState(this.partyId);

                // Send snapshot directly to new peer
                this.actionMsg
                    .send(
                        {
                            type: 'snapshot',
                            snapshot: {
                                party: this.party,
                                members: this.members,
                                messages: this.messages.slice(-50),
                                requests: this.requests,
                                memberId: guestMemberId,
                                isHost: false,
                            },
                        },
                        { target: peerId }
                    )
                    .catch(() => {});

                // Broadcast updated members list to all peers
                this.actionMsg.send({ type: 'members', members: this.members }).catch(() => {});
                this._emit({ type: 'members', members: this.members });
            }
            return;
        }

        // 2. Host presence announcement
        if (message.type === 'host_presence') {
            if (!this.isHost && this.party) {
                this.party.host_peer_id = message.hostPeerId || peerId;
            }
            return;
        }

        // 3. Snapshot received by Guest
        if (message.type === 'snapshot' && message.snapshot) {
            if (this.pendingJoin) {
                clearTimeout(this.pendingJoin.timeout);
                if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
                this.joinRetryTimer = null;

                const snap = message.snapshot;
                this.party = snap.party;
                if (this.party) this.party.host_peer_id = peerId;
                this.members = snap.members || [];
                this.messages = snap.messages || [];
                this.requests = snap.requests || [];

                this.pendingJoin.resolve(snap);
                this.pendingJoin = null;
            }
            this._emit(message);
            return;
        }

        // 4. Playback state update
        if (message.type === 'party' && message.party) {
            this.party = { ...this.party, ...message.party, host_peer_id: peerId };
            this._emit({ type: 'party', party: this.party });
            return;
        }

        // 5. Members list update
        if (message.type === 'members' && Array.isArray(message.members)) {
            this.members = message.members;
            this._emit({ type: 'members', members: this.members });
            return;
        }

        // 6. Chat message
        if (message.type === 'message' && message.message) {
            this.messages.push(message.message);
            if (this.messages.length > 100) this.messages = this.messages.slice(-100);
            this._emit({ type: 'message', message: message.message });
            return;
        }

        // 7. Song requests list
        if (message.type === 'requests' && Array.isArray(message.requests)) {
            this.requests = message.requests;
            this._emit({ type: 'requests', requests: this.requests });
            return;
        }

        // 8. Individual song request from guest
        if (message.type === 'request' && message.request) {
            if (this.isHost) {
                this.requests.push(message.request);
                this._saveHostState(this.partyId);
                this.actionMsg.send({ type: 'requests', requests: this.requests }).catch(() => {});
                this._emit({ type: 'requests', requests: this.requests });
            }
            return;
        }

        // 9. Remove request
        if (message.type === 'request:remove' && message.requestId) {
            if (this.isHost) {
                this.requests = this.requests.filter((r) => r.id !== message.requestId);
                this._saveHostState(this.partyId);
                this.actionMsg.send({ type: 'requests', requests: this.requests }).catch(() => {});
                this._emit({ type: 'requests', requests: this.requests });
            }
            return;
        }

        // 10. Typing indicator
        if (message.type === 'typing') {
            const member = (this.members || []).find((m) => m.id === message.memberId);
            if (member) {
                member.typing_until = message.typing_until;
                this._emit({ type: 'members', members: this.members });
            }
            return;
        }

        // 11. Party ended
        if (message.type === 'ended') {
            this._emit({ type: 'ended' });
            return;
        }
    }

    async send(type, payload = {}) {
        if (!this.room || !this.actionMsg) return;

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
                host_peer_id: selfId,
            };
            this._saveHostState(this.partyId);
            await this.actionMsg.send({ type: 'party', party: this.party }).catch(() => {});
            this._emit({ type: 'party', party: this.party });
            return;
        }

        // Chat message
        if (type === 'chat') {
            const msg = {
                id: 'msg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
                sender_name: this.localProfile?.name || 'Listener',
                sender_id: this.memberId,
                content: payload.content,
                timestamp: Date.now(),
            };
            await this.actionMsg.send({ type: 'message', message: msg }).catch(() => {});
            this.messages.push(msg);
            if (this.messages.length > 100) this.messages = this.messages.slice(-100);
            this._emit({ type: 'message', message: msg });
            return;
        }

        // Song request
        if (type === 'request') {
            const req = {
                id: 'req_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
                track: payload.track,
                requested_by: this.localProfile?.name || 'Listener',
                requested_by_id: this.memberId,
            };
            if (this.isHost) {
                this.requests.push(req);
                this._saveHostState(this.partyId);
                await this.actionMsg.send({ type: 'requests', requests: this.requests }).catch(() => {});
                this._emit({ type: 'requests', requests: this.requests });
            } else {
                await this.actionMsg.send({ type: 'request', request: req }).catch(() => {});
            }
            return;
        }

        // Remove request
        if (type === 'request:remove') {
            if (this.isHost) {
                this.requests = this.requests.filter((r) => r.id !== payload.requestId);
                this._saveHostState(this.partyId);
                await this.actionMsg.send({ type: 'requests', requests: this.requests }).catch(() => {});
                this._emit({ type: 'requests', requests: this.requests });
            } else {
                await this.actionMsg.send({ type: 'request:remove', requestId: payload.requestId }).catch(() => {});
            }
            return;
        }

        // Typing indicator
        if (type === 'typing') {
            await this.actionMsg
                .send({
                    type: 'typing',
                    memberId: this.memberId,
                    typing_until: payload.typing_until,
                })
                .catch(() => {});
            return;
        }

        // Heartbeat
        if (type === 'heartbeat') {
            return;
        }

        // Leave party
        if (type === 'leave') {
            if (payload.end && this.isHost) {
                await this.actionMsg.send({ type: 'ended' }).catch(() => {});
                this._clearHostState(this.partyId);
            }
            this.close();
            return;
        }
    }

    close() {
        if (this.joinRetryTimer) {
            clearInterval(this.joinRetryTimer);
            this.joinRetryTimer = null;
        }
        if (this.pendingJoin) {
            clearTimeout(this.pendingJoin.timeout);
            this.pendingJoin = null;
        }
        if (this.room) {
            try {
                this.room.leave();
            } catch (_e) {}
            this.room = null;
        }
        this.actionMsg = null;
        this.handlers.clear();
        this.knownPeers.clear();
    }
}
