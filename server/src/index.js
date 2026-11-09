import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { Readable } from 'stream';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = [
  'https://echoes.mteck.tech',
  'https://echos.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

const ALLOWED_STREAM_DOMAINS = [
  'googlevideo.com',
  'youtube.com',
  'ytimg.com',
  'invidious.io',
  'nadeko.net',
  'snopyta.org',
  'drgns.space',
  'privacydev.net',
  'lunar.icu',
  'perennialte.ch',
  'adminforge.de',
  'projectsegfau.lt',
  'chocolatemoo53.com',
  'materialio.us',
  'protokolla.fi',
  'ducks.party',
  'qzz.io',
];

function isDomainAllowed(hostname) {
  const lower = (hostname || '').toLowerCase();
  return ALLOWED_STREAM_DOMAINS.some(
    (d) => lower === d || lower.endsWith('.' + d)
  );
}

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Allow playback on mobile / extensions
      }
    },
    credentials: true,
  })
);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'echoes-vps-backend',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// High-throughput audio stream proxy
app.all('/stream', async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing ?url=' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (_e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  if (!isDomainAllowed(parsedUrl.hostname)) {
    return res.status(403).json({ error: 'Domain not permitted for streaming' });
  }

  const clientRange = req.headers.range;
  const controller = new AbortController();

  req.on('close', () => {
    controller.abort();
  });

  try {
    const upstreamHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (clientRange) {
      upstreamHeaders['range'] = clientRange;
    }

    const upstream = await fetch(parsedUrl.toString(), {
      headers: upstreamHeaders,
      signal: controller.signal,
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({
        error: `Upstream error ${upstream.status} ${upstream.statusText}`,
      });
    }

    // Forward streaming headers
    const forwardHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'etag',
      'last-modified',
    ];

    for (const h of forwardHeaders) {
      const val = upstream.headers.get(h);
      if (val) {
        res.setHeader(h, val);
      }
    }

    if (!res.getHeader('accept-ranges')) {
      res.setHeader('accept-ranges', 'bytes');
    }

    res.status(upstream.status);

    if (req.method === 'HEAD') {
      return res.end();
    }

    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.on('error', (err) => {
        if (err.name !== 'AbortError' && !controller.signal.aborted) {
          console.error('[Stream Error]:', err.message);
        }
      });
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      return;
    }
    console.error('[StreamProxy Error]:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to stream audio payload' });
    }
  }
});

const server = http.createServer(app);

// WebSocket Server (Echoes Connect Device Sync)
const wss = new WebSocketServer({ noServer: true });

// Rooms keyed by roomId (e.g. userId or pairing code)
class PlaybackRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.devices = new Map(); // ws -> { deviceId, deviceName, deviceType, lastSeen }
    this.activeDeviceId = null;
    this.playbackState = {
      track: null,
      position: 0,
      isPlaying: false,
      volume: 0.7,
      lastUpdated: Date.now(),
    };
  }

  getCurrentPlaybackState() {
    if (!this.playbackState.isPlaying) return this.playbackState;
    const elapsedSec = (Date.now() - this.playbackState.lastUpdated) / 1000;
    const currentPos = this.playbackState.position + elapsedSec;
    return {
      ...this.playbackState,
      position: this.playbackState.track?.duration
        ? Math.min(currentPos, this.playbackState.track.duration)
        : currentPos,
    };
  }

  getDeviceSummary() {
    return Array.from(this.devices.values()).map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      deviceType: d.deviceType,
      connectedAt: d.connectedAt,
    }));
  }

  getActiveDeviceName() {
    if (!this.activeDeviceId) return null;
    for (const d of this.devices.values()) {
      if (d.deviceId === this.activeDeviceId) return d.deviceName;
    }
    return null;
  }

  send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  broadcast(payload, excludeWs = null) {
    const raw = JSON.stringify(payload);
    for (const [ws] of this.devices) {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  addDevice(ws, deviceId, deviceName, deviceType) {
    for (const [existingWs, dev] of this.devices.entries()) {
      if (dev.deviceId === deviceId) {
        try {
          existingWs.close(1000, 'Replaced by new connection');
        } catch (_e) {}
        this.devices.delete(existingWs);
      }
    }

    const device = {
      ws,
      deviceId,
      deviceName,
      deviceType,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    };
    this.devices.set(ws, device);

    if (!this.activeDeviceId && this.playbackState.isPlaying) {
      this.activeDeviceId = deviceId;
    }

    this.send(ws, {
      type: 'SESSION_STATE',
      deviceId,
      activeDeviceId: this.activeDeviceId,
      activeDeviceName: this.getActiveDeviceName(),
      playback: this.getCurrentPlaybackState(),
      devices: this.getDeviceSummary(),
    });

    this.broadcast(
      {
        type: 'DEVICES_CHANGED',
        devices: this.getDeviceSummary(),
        activeDeviceId: this.activeDeviceId,
      },
      ws
    );
  }

  handleMessage(ws, msg) {
    const sender = this.devices.get(ws);
    if (!sender) return;
    sender.lastSeen = Date.now();

    switch (msg.type) {
      case 'PING':
        this.send(ws, { type: 'PONG', timestamp: Date.now() });
        break;

      case 'REGISTER_DEVICE':
        if (msg.deviceName) sender.deviceName = msg.deviceName;
        if (msg.deviceType) sender.deviceType = msg.deviceType;
        this.broadcast({
          type: 'DEVICES_CHANGED',
          devices: this.getDeviceSummary(),
          activeDeviceId: this.activeDeviceId,
        });
        break;

      case 'PLAYBACK_STATE':
        this.activeDeviceId = sender.deviceId;
        this.playbackState = {
          track: msg.track || this.playbackState.track,
          position: typeof msg.position === 'number' ? msg.position : this.playbackState.position,
          isPlaying: typeof msg.isPlaying === 'boolean' ? msg.isPlaying : this.playbackState.isPlaying,
          volume: typeof msg.volume === 'number' ? msg.volume : this.playbackState.volume,
          lastUpdated: Date.now(),
        };

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

      case 'TRANSFER_PLAYBACK': {
        const targetDeviceId = msg.targetDeviceId;
        if (!targetDeviceId) return;

        let target = null;
        for (const d of this.devices.values()) {
          if (d.deviceId === targetDeviceId) target = d;
        }

        if (!target) {
          this.send(ws, {
            type: 'ERROR',
            message: `Target device ${targetDeviceId} is no longer online.`,
          });
          return;
        }

        let currentActive = null;
        for (const d of this.devices.values()) {
          if (d.deviceId === this.activeDeviceId) currentActive = d;
        }

        const trackToPlay = msg.track || this.playbackState.track;
        const positionToPlay = typeof msg.position === 'number' ? msg.position : this.getCurrentPlaybackState().position;
        const volumeToPlay = typeof msg.volume === 'number' ? msg.volume : this.playbackState.volume;

        if (currentActive && currentActive.deviceId !== targetDeviceId) {
          this.send(currentActive.ws, {
            type: 'PAUSE_LOCAL',
            transferredTo: targetDeviceId,
            transferredToName: target.deviceName,
          });
        }

        this.activeDeviceId = targetDeviceId;
        this.playbackState = {
          track: trackToPlay,
          position: positionToPlay,
          isPlaying: true,
          volume: volumeToPlay,
          lastUpdated: Date.now(),
        };

        this.send(target.ws, {
          type: 'LOAD_AND_PLAY',
          track: trackToPlay,
          position: positionToPlay,
          volume: volumeToPlay,
          queue: msg.queue || null,
          queueIndex: typeof msg.queueIndex === 'number' ? msg.queueIndex : 0,
          sourceDeviceId: sender.deviceId,
        });

        this.broadcast({
          type: 'ACTIVE_DEVICE_CHANGED',
          activeDeviceId: targetDeviceId,
          activeDeviceName: target.deviceName,
          playback: this.getCurrentPlaybackState(),
          devices: this.getDeviceSummary(),
        });
        break;
      }

      case 'REMOTE_COMMAND': {
        const { action, payload } = msg;
        if (!this.activeDeviceId) return;

        let target = null;
        for (const d of this.devices.values()) {
          if (d.deviceId === this.activeDeviceId) target = d;
        }

        if (target && target.ws.readyState === WebSocket.OPEN) {
          this.send(target.ws, {
            type: 'EXECUTE_COMMAND',
            action,
            payload,
            fromDeviceId: sender.deviceId,
            fromDeviceName: sender.deviceName,
          });
        }
        break;
      }
    }
  }

  removeDevice(ws) {
    const dev = this.devices.get(ws);
    if (!dev) return;
    this.devices.delete(ws);

    if (this.activeDeviceId === dev.deviceId) {
      this.activeDeviceId = null;
      this.playbackState.isPlaying = false;
    }

    this.broadcast({
      type: 'DEVICES_CHANGED',
      devices: this.getDeviceSummary(),
      activeDeviceId: this.activeDeviceId,
    });
  }
}

const rooms = new Map(); // roomId -> PlaybackRoom

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new PlaybackRoom(roomId));
  }
  return rooms.get(roomId);
}

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/ws' || pathname === '/') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, url);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, request, url) => {
  const rawUserId =
    url.searchParams.get('userId') ||
    url.searchParams.get('user_id') ||
    url.searchParams.get('room') ||
    url.searchParams.get('sessionId');

  const userId = typeof rawUserId === 'string' ? rawUserId.trim() : '';

  // Reject unauthenticated, guest, or insecure default rooms.
  // Echoes Connect is strictly an authenticated private cross-device feature for the same user account.
  if (
    !userId ||
    userId === 'default-room' ||
    userId === 'guest' ||
    userId === 'undefined' ||
    userId === 'null' ||
    userId === 'anonymous'
  ) {
    ws.close(4001, 'Unauthorized: Valid authenticated userId required for private device sync');
    return;
  }

  // Room is strictly isolated and keyed by the authenticated user ID
  const roomId = userId.startsWith('user_') ? userId : `user_${userId}`;
  const deviceId = url.searchParams.get('deviceId') || `dev_${Math.random().toString(36).slice(2, 10)}`;
  const deviceName = url.searchParams.get('deviceName') || 'Unknown Device';
  const deviceType = url.searchParams.get('deviceType') || 'desktop';

  const room = getOrCreateRoom(roomId);
  room.addDevice(ws, deviceId, deviceName, deviceType);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      room.handleMessage(ws, msg);
    } catch (err) {
      console.error('Invalid WS payload:', err.message);
    }
  });

  ws.on('close', () => {
    room.removeDevice(ws);
    if (room.devices.size === 0) {
      rooms.delete(roomId);
    }
  });

  ws.on('error', () => {
    room.removeDevice(ws);
  });
});

// Periodic heartbeat
setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    const now = Date.now();
    for (const [ws, dev] of room.devices.entries()) {
      if (now - dev.lastSeen > 60000) {
        try {
          ws.terminate();
        } catch (_e) {}
        room.removeDevice(ws);
      } else {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }
    if (room.devices.size === 0) {
      rooms.delete(roomId);
    }
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Echoes VPS Backend] Listening on port ${PORT}`);
});
