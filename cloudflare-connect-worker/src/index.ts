/**
 * Echos Connect - Serverless Spotify Connect Edge Worker
 * Powered by Cloudflare Workers & Durable Objects
 *
 * Each user gets a dedicated, in-memory stateful actor room (`PlaybackRoom`).
 * Devices (TV, Phone, Desktop, Tablet) maintain an open WebSocket connection.
 * Any device can seamlessly inspect active playback, transfer playback,
 * or remotely control (play, pause, seek, volume, next, prev) with sub-50ms latency.
 */

export interface Env {
  PLAYBACK_ROOM: DurableObjectNamespace;
}

interface ConnectedDevice {
  ws: WebSocket;
  deviceId: string;
  deviceName: string;
  deviceType: 'tv' | 'mobile' | 'desktop' | 'tablet';
  connectedAt: number;
  lastSeen: number;
}

interface PlaybackState {
  track: any | null;
  position: number;
  isPlaying: boolean;
  volume: number;
  lastUpdated: number;
}

export class PlaybackRoom {
  private state: DurableObjectState;
  private devices: Map<WebSocket, ConnectedDevice> = new Map();
  private activeDeviceId: string | null = null;
  private playbackState: PlaybackState = {
    track: null,
    position: 0,
    isPlaying: false,
    volume: 0.7,
    lastUpdated: Date.now(),
  };

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // REST debug / health endpoint
    if (url.pathname === '/state') {
      return new Response(
        JSON.stringify({
          activeDeviceId: this.activeDeviceId,
          playbackState: this.getCurrentPlaybackState(),
          devices: this.getDeviceSummary(),
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // WebSocket upgrade check
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', {
        status: 426,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const { 0: clientWs, 1: serverWs } = new WebSocketPair();
    serverWs.accept();

    // Extract query parameters for immediate registration
    const deviceId = url.searchParams.get('deviceId') || crypto.randomUUID();
    const deviceName = url.searchParams.get('deviceName') || 'Unknown Device';
    const deviceType = (url.searchParams.get('deviceType') as any) || 'desktop';

    this.handleNewConnection(serverWs, deviceId, deviceName, deviceType);

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  private handleNewConnection(
    ws: WebSocket,
    deviceId: string,
    deviceName: string,
    deviceType: 'tv' | 'mobile' | 'desktop' | 'tablet'
  ) {
    // If device reconnected with same deviceId, remove stale connection
    for (const [existingWs, dev] of this.devices.entries()) {
      if (dev.deviceId === deviceId) {
        try {
          existingWs.close(1000, 'Replaced by new connection');
        } catch (_e) {}
        this.devices.delete(existingWs);
      }
    }

    const device: ConnectedDevice = {
      ws,
      deviceId,
      deviceName,
      deviceType,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    };
    this.devices.set(ws, device);

    // If no active device is currently designated, check if any is playing
    if (!this.activeDeviceId && this.playbackState.isPlaying) {
      this.activeDeviceId = deviceId;
    }

    // Immediately transmit current room state to the newly connected device
    const currentState = this.getCurrentPlaybackState();
    this.send(ws, {
      type: 'SESSION_STATE',
      deviceId,
      activeDeviceId: this.activeDeviceId,
      activeDeviceName: this.getActiveDeviceName(),
      playback: currentState,
      devices: this.getDeviceSummary(),
    });

    // Notify all other devices of the new device presence
    this.broadcast(
      {
        type: 'DEVICES_CHANGED',
        devices: this.getDeviceSummary(),
        activeDeviceId: this.activeDeviceId,
      },
      ws
    );

    // WebSocket event listeners
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.handleMessage(ws, data);
      } catch (err) {
        console.error('Invalid WS message payload:', err);
      }
    });

    ws.addEventListener('close', () => {
      this.handleDisconnect(ws);
    });

    ws.addEventListener('error', () => {
      this.handleDisconnect(ws);
    });
  }

  private handleMessage(ws: WebSocket, msg: any) {
    const sender = this.devices.get(ws);
    if (!sender) return;
    sender.lastSeen = Date.now();

    switch (msg.type) {
      case 'PING':
        this.send(ws, { type: 'PONG', timestamp: Date.now() });
        break;

      case 'REGISTER_DEVICE': {
        if (msg.deviceName) sender.deviceName = msg.deviceName;
        if (msg.deviceType) sender.deviceType = msg.deviceType;
        this.broadcast({
          type: 'DEVICES_CHANGED',
          devices: this.getDeviceSummary(),
          activeDeviceId: this.activeDeviceId,
        });
        break;
      }

      // Emitted by the actively playing device
      case 'PLAYBACK_STATE': {
        this.activeDeviceId = sender.deviceId;
        this.playbackState = {
          track: msg.track || this.playbackState.track,
          position: typeof msg.position === 'number' ? msg.position : this.playbackState.position,
          isPlaying: typeof msg.isPlaying === 'boolean' ? msg.isPlaying : this.playbackState.isPlaying,
          volume: typeof msg.volume === 'number' ? msg.volume : this.playbackState.volume,
          lastUpdated: Date.now(),
        };

        // Broadcast current audio status to all other listening devices (remote controllers)
        this.broadcast(
          {
            type: 'REMOTE_STATE_UPDATE',
            activeDeviceId: this.activeDeviceId,
            activeDeviceName: sender.deviceName,
            playback: this.getCurrentPlaybackState(),
          },
          ws
        );
        break;
      }

      // Triggered when user picks another device in the modal ("Transfer to TV" or "Transfer to Phone")
      case 'TRANSFER_PLAYBACK': {
        const targetDeviceId = msg.targetDeviceId;
        if (!targetDeviceId) return;

        const target = this.findDeviceById(targetDeviceId);
        if (!target) {
          this.send(ws, {
            type: 'ERROR',
            message: `Target device ${targetDeviceId} is no longer online.`,
          });
          return;
        }

        const currentActive = this.activeDeviceId ? this.findDeviceById(this.activeDeviceId) : null;
        const currentPlayback = this.getCurrentPlaybackState();

        // 1. Tell current active device to pause locally
        if (currentActive && currentActive.deviceId !== targetDeviceId) {
          this.send(currentActive.ws, {
            type: 'PAUSE_LOCAL',
            transferredTo: targetDeviceId,
            transferredToName: target.deviceName,
          });
        }

        // 2. Transfer playback baton to target device
        this.activeDeviceId = targetDeviceId;
        this.playbackState.isPlaying = true;
        this.playbackState.lastUpdated = Date.now();

        this.send(target.ws, {
          type: 'LOAD_AND_PLAY',
          track: currentPlayback.track,
          position: currentPlayback.position,
          volume: currentPlayback.volume,
          sourceDeviceId: sender.deviceId,
        });

        // 3. Broadcast new active device across all screens
        this.broadcast({
          type: 'ACTIVE_DEVICE_CHANGED',
          activeDeviceId: targetDeviceId,
          activeDeviceName: target.deviceName,
          playback: this.getCurrentPlaybackState(),
          devices: this.getDeviceSummary(),
        });
        break;
      }

      // Remote control commands (Play, Pause, Seek, Next, Prev, Volume)
      case 'REMOTE_COMMAND': {
        const { action, payload } = msg;
        const activeDevice = this.activeDeviceId ? this.findDeviceById(this.activeDeviceId) : null;

        if (!activeDevice) {
          this.send(ws, { type: 'ERROR', message: 'No active device is currently playing.' });
          return;
        }

        // Forward execution command directly to the active hardware player
        this.send(activeDevice.ws, {
          type: 'EXECUTE_COMMAND',
          action,
          payload,
          senderDeviceId: sender.deviceId,
          senderName: sender.deviceName,
        });

        // Optimistically update local room state
        if (action === 'PAUSE') {
          this.playbackState.isPlaying = false;
          this.playbackState.lastUpdated = Date.now();
        } else if (action === 'PLAY') {
          this.playbackState.isPlaying = true;
          this.playbackState.lastUpdated = Date.now();
        } else if (action === 'SEEK' && typeof payload?.position === 'number') {
          this.playbackState.position = payload.position;
          this.playbackState.lastUpdated = Date.now();
        } else if (action === 'VOLUME' && typeof payload?.volume === 'number') {
          this.playbackState.volume = payload.volume;
        }

        // Broadcast to all remote controllers
        this.broadcast(
          {
            type: 'REMOTE_STATE_UPDATE',
            activeDeviceId: this.activeDeviceId,
            activeDeviceName: activeDevice.deviceName,
            playback: this.getCurrentPlaybackState(),
          },
          activeDevice.ws
        );
        break;
      }

      default:
        console.warn('Unhandled message type:', msg.type);
    }
  }

  private handleDisconnect(ws: WebSocket) {
    const dev = this.devices.get(ws);
    if (!dev) return;

    this.devices.delete(ws);

    // If the disconnecting device was currently outputting audio
    if (this.activeDeviceId === dev.deviceId) {
      this.playbackState.isPlaying = false;
      this.playbackState.lastUpdated = Date.now();
      // Leave activeDeviceId so remaining devices can see what was last playing,
      // but inform everyone that playback has stopped
    }

    this.broadcast({
      type: 'DEVICES_CHANGED',
      devices: this.getDeviceSummary(),
      activeDeviceId: this.activeDeviceId,
      disconnectedDevice: dev.deviceId,
    });
  }

  /**
   * Calculates live playback position with clock-drift compensation.
   */
  private getCurrentPlaybackState() {
    let currentPosition = this.playbackState.position;
    if (this.playbackState.isPlaying && this.playbackState.lastUpdated) {
      const elapsedSeconds = (Date.now() - this.playbackState.lastUpdated) / 1000;
      currentPosition += elapsedSeconds;
    }

    return {
      track: this.playbackState.track,
      position: Math.max(0, currentPosition),
      isPlaying: this.playbackState.isPlaying,
      volume: this.playbackState.volume,
      lastUpdated: this.playbackState.lastUpdated,
    };
  }

  private getDeviceSummary() {
    const list: any[] = [];
    for (const dev of this.devices.values()) {
      list.push({
        id: dev.deviceId,
        name: dev.deviceName,
        type: dev.deviceType,
        isActive: dev.deviceId === this.activeDeviceId,
        connectedAt: dev.connectedAt,
      });
    }
    return list;
  }

  private getActiveDeviceName(): string {
    if (!this.activeDeviceId) return 'No active device';
    const active = this.findDeviceById(this.activeDeviceId);
    return active ? active.deviceName : 'Connected Device';
  }

  private findDeviceById(deviceId: string): ConnectedDevice | null {
    for (const dev of this.devices.values()) {
      if (dev.deviceId === deviceId) return dev;
    }
    return null;
  }

  private send(ws: WebSocket, payload: any) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    } catch (_err) {}
  }

  private broadcast(payload: any, excludeWs?: WebSocket) {
    const data = JSON.stringify(payload);
    for (const [ws] of this.devices.entries()) {
      if (excludeWs && ws === excludeWs) continue;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      } catch (_err) {}
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          service: 'echos-connect-worker',
          status: 'online',
          engine: 'Cloudflare Workers + Durable Objects',
          timestamp: new Date().toISOString(),
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // WebSocket / state endpoints require userId or roomId
    // e.g. /ws?userId=usr_123 or /rooms/usr_123
    let userId = url.searchParams.get('userId') || url.searchParams.get('user');
    if (!userId) {
      const match = url.pathname.match(/^\/(?:rooms|ws)\/([a-zA-Z0-9_-]+)/);
      if (match) userId = match[1];
    }

    if (!userId) {
      // Default to guest / global device room if none provided
      userId = 'default-guest-room';
    }

    // Bind strongly-consistent Durable Object instance unique to this user
    const id = env.PLAYBACK_ROOM.idFromName(`user:${userId}`);
    const room = env.PLAYBACK_ROOM.get(id);

    return room.fetch(request);
  },
};
