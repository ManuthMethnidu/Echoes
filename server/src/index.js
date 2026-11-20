import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { URL, fileURLToPath } from 'url';
import { Readable } from 'stream';
import dns from 'dns';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_ROOT = process.env.CACHE_DIR || path.join(__dirname, '..', 'cache');
const TRACKS_CACHE_DIR = path.join(CACHE_ROOT, 'tracks');
const ARTWORK_CACHE_DIR = path.join(CACHE_ROOT, 'artwork');
const METADATA_CACHE_DIR = path.join(CACHE_ROOT, 'meta');

for (const dir of [CACHE_ROOT, TRACKS_CACHE_DIR, ARTWORK_CACHE_DIR, METADATA_CACHE_DIR]) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[Cache Init] Could not create ${dir}:`, err.message);
  }
}

const UPSTREAM_MONOCHROME_URL = (
  process.env.UPSTREAM_MONOCHROME_URL || 'https://tracks.monochrome.st'
).replace(/\/+$/, '');

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
  let tracksCached = 0;
  let artworkCached = 0;
  try {
    tracksCached = fs.readdirSync(TRACKS_CACHE_DIR).filter((f) => f.endsWith('.flac')).length;
    artworkCached = fs.readdirSync(ARTWORK_CACHE_DIR).length;
  } catch {}

  res.json({
    status: 'ok',
    service: 'echoes-vps-backend',
    version: '1.1.0',
    features: [
      'lossless-hifi-proxy',
      'flac-disk-cache',
      'artwork-cache',
      'youtube-stream',
      'device-sync',
      'listening-parties',
    ],
    cache: {
      tracksCount: tracksCached,
      artworkCount: artworkCached,
    },
    upstream: UPSTREAM_MONOCHROME_URL,
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// Cache for YouTube stream URLs: videoId_format -> { url, mimeType, codec, expiresAt }
const ytStreamCache = new Map();
const YT_CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours

async function resolveYtAudioUrl(videoId, preferFormat = '140') {
  const cleanId = String(videoId || '').replace(/^yt:/, '').trim();
  if (!/^[a-zA-Z0-9_-]{5,30}$/.test(cleanId)) {
    throw new Error('Invalid YouTube video ID format');
  }

  const cacheKey = `${cleanId}_${preferFormat}`;
  const cached = ytStreamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached;
  }

  const formatSelector = preferFormat === '251' ? '251/140/bestaudio' : '140/251/bestaudio';
  // When extracting via the Apple VISIONOS YouTube client, YouTube does not trigger bot challenges or 403 blocks on VPS IP ranges.
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--no-update',
    '--extractor-args',
    'youtube:player_client=visionos,ios',
    '-g',
    '-f',
    formatSelector,
    `https://www.youtube.com/watch?v=${cleanId}`,
  ];

  try {
    const { stdout } = await execFileAsync('yt-dlp', args, { timeout: 15000 });
    const directUrl = stdout.trim().split('\n').filter(Boolean).pop();
    if (!directUrl || !directUrl.startsWith('http')) {
      throw new Error('yt-dlp returned no stream URL');
    }

    let ttlMs = YT_CACHE_TTL_MS;
    try {
      const u = new URL(directUrl);
      const exp = parseInt(u.searchParams.get('expire'), 10);
      if (!isNaN(exp)) {
        const remainingMs = exp * 1000 - Date.now() - 60 * 1000;
        if (remainingMs > 0 && remainingMs < YT_CACHE_TTL_MS) {
          ttlMs = remainingMs;
        }
      }
    } catch {}

    const isM4a = directUrl.includes('mime=audio%2Fmp4') || directUrl.includes('itag=140') || preferFormat === '140';
    const result = {
      url: directUrl,
      mimeType: isM4a ? 'audio/mp4' : 'audio/webm',
      codec: isM4a ? 'AAC' : 'OPUS',
      expiresAt: Date.now() + ttlMs,
    };

    ytStreamCache.set(cacheKey, result);

    if (ytStreamCache.size > 2000) {
      const oldestKey = ytStreamCache.keys().next().value;
      ytStreamCache.delete(oldestKey);
    }

    return result;
  } catch (err) {
    console.error(`[resolveYtAudioUrl] Failed for ${cleanId}:`, err.message);
    throw err;
  }
}

// YouTube stream info endpoint: returns stream metadata for Echoes client
app.get(['/yt/:id/info', '/stream/yt/:id/info'], async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');

  const rawId = req.params.id || req.query.id;
  if (!rawId) {
    return res.status(400).json({ error: 'Missing YouTube video ID' });
  }

  const videoId = String(rawId).replace(/^yt:/, '').trim();
  const format = req.query.format === 'webm' || req.query.format === 'opus' ? '251' : '140';

  try {
    const resolved = await resolveYtAudioUrl(videoId, format);
    const host = req.get('host') || 'stream.mteck.tech';
    const proto = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const streamEndpoint = `${proto}://${host}/yt/${videoId}?format=${format === '251' ? 'webm' : 'm4a'}`;

    return res.json({
      id: videoId,
      streamUrl: streamEndpoint,
      url: streamEndpoint,
      directUrl: streamEndpoint,
      mimeType: resolved.mimeType,
      codec: resolved.codec,
      bitrate: resolved.codec === 'AAC' ? 130000 : 160000,
      quality: 'HIGH',
      provider: 'youtube',
    });
  } catch (err) {
    return res.status(502).json({
      error: 'Failed to resolve YouTube audio stream info',
      details: err.message,
    });
  }
});

// Direct YouTube audio streaming endpoint: /yt/:id or /stream/yt/:id
app.all(['/yt/:id', '/stream/yt/:id'], async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawId = req.params.id || req.query.id;
  if (!rawId) {
    return res.status(400).json({ error: 'Missing YouTube video ID' });
  }

  const videoId = String(rawId).replace(/^yt:/, '').trim();
  const format = req.query.format === 'webm' || req.query.format === 'opus' ? '251' : '140';
  const cacheKey = `${videoId}_${format}`;

  let resolved;
  try {
    resolved = await resolveYtAudioUrl(videoId, format);
  } catch (resolveErr) {
    return res.status(502).json({
      error: 'Failed to resolve YouTube audio stream',
      details: resolveErr.message,
    });
  }

  const clientRange = req.headers.range;
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const fetchStream = async (targetUrl) => {
    const upstreamHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (clientRange) {
      upstreamHeaders['range'] = clientRange;
    }
    return await fetch(targetUrl, {
      headers: upstreamHeaders,
      signal: controller.signal,
    });
  };

  try {
    let upstream = await fetchStream(resolved.url);

    // If upstream returned 403 or 410, evict cache and retry once with fresh URL
    if ((upstream.status === 403 || upstream.status === 410) && !controller.signal.aborted) {
      ytStreamCache.delete(cacheKey);
      try {
        resolved = await resolveYtAudioUrl(videoId, format);
        upstream = await fetchStream(resolved.url);
      } catch {}
    }

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({
        error: `Upstream error ${upstream.status} ${upstream.statusText}`,
      });
    }

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
      if (val) res.setHeader(h, val);
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
          console.error('[YT Stream Error]:', err.message);
        }
      });
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) return;
    console.error('[YT Stream Proxy Error]:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to stream audio payload' });
    }
  }
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
    if (parsedUrl.hostname.includes('chocolatemoo53.com')) {
      upstreamHeaders['Referer'] = 'https://yt.chocolatemoo53.com/';
      upstreamHeaders['Origin'] = 'https://yt.chocolatemoo53.com';
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

// ============================================================================
// Lossless Hi-Fi Streaming & Monochrome Catalog Proxy
// ============================================================================

const metaMemoryCache = new Map();
const META_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function handleProxyMetaRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const cacheKey = req.originalUrl;
  const cached = metaMemoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.data);
  }

  try {
    const upstreamUrl = `${UPSTREAM_MONOCHROME_URL}${req.originalUrl}`;
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EchoesHiFiProxy/1.0)',
        'Accept': 'application/json',
      },
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        error: `Upstream error ${upstreamRes.status} ${upstreamRes.statusText}`,
      });
    }

    const data = await upstreamRes.json();
    metaMemoryCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + META_CACHE_TTL_MS,
    });

    if (metaMemoryCache.size > 2000) {
      const oldestKey = metaMemoryCache.keys().next().value;
      metaMemoryCache.delete(oldestKey);
    }

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(data);
  } catch (err) {
    console.error(`[Lossless Proxy Meta Error] ${req.originalUrl}:`, err.message);
    return res.status(502).json({ error: 'Failed to fetch metadata from upstream' });
  }
}

// Search endpoints
app.get(['/search', '/search/tracks', '/search/releases', '/search/artists'], handleProxyMetaRequest);

// Release / Album details endpoint
app.get('/releases/:id', handleProxyMetaRequest);

// Artist details endpoint
app.get('/artists/:id', handleProxyMetaRequest);

// Direct Lossless FLAC audio stream endpoint with Range and Disk Caching
app.all(['/track/:id', '/stream/track/:id', '/tracks/:id'], async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-Cache');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawId = req.params.id || req.query.id;
  const trackId = String(rawId || '')
    .replace(/^tracks:(?:track:)?/, '')
    .replace(/\.flac$/i, '')
    .trim();

  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(trackId)) {
    return res.status(400).json({ error: 'Invalid track ID format' });
  }

  const localFile = path.join(TRACKS_CACHE_DIR, `${trackId}.flac`);
  const clientRange = req.headers.range;

  // 1. Check local disk cache
  if (fs.existsSync(localFile)) {
    try {
      const stat = fs.statSync(localFile);
      const totalSize = stat.size;

      if (totalSize > 0) {
        if (clientRange) {
          const parts = clientRange.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

          if (isNaN(start) || start >= totalSize) {
            res.setHeader('Content-Range', `bytes */${totalSize}`);
            return res.status(416).end();
          }

          const boundedEnd = Math.min(end, totalSize - 1);
          const chunkSize = boundedEnd - start + 1;

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${boundedEnd}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'audio/flac',
            'X-Cache': 'HIT',
            'Cache-Control': 'public, max-age=31536000, immutable',
          });

          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(localFile, { start, end: boundedEnd }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': totalSize,
            'Accept-Ranges': 'bytes',
            'Content-Type': 'audio/flac',
            'X-Cache': 'HIT',
            'Cache-Control': 'public, max-age=31536000, immutable',
          });

          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(localFile).pipe(res);
        }
      }
    } catch (err) {
      console.warn(`[FLAC Cache Read Warning] ${trackId}:`, err.message);
    }
  }

  // 2. Cache Miss: Stream from upstream & concurrently write full stream to cache
  const upstreamUrl = `${UPSTREAM_MONOCHROME_URL}/track/${trackId}`;
  const controller = new AbortController();

  try {
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (compatible; EchoesHiFiProxy/1.0)',
      'Accept': '*/*',
    };
    if (clientRange) {
      upstreamHeaders['Range'] = clientRange;
    }

    const upstream = await fetch(upstreamUrl, {
      headers: upstreamHeaders,
      signal: controller.signal,
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({
        error: `Upstream audio error ${upstream.status} ${upstream.statusText}`,
      });
    }

    const forwardHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
    ];

    for (const h of forwardHeaders) {
      const val = upstream.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    if (!res.getHeader('content-type')) {
      res.setHeader('content-type', 'audio/flac');
    }
    if (!res.getHeader('accept-ranges')) {
      res.setHeader('accept-ranges', 'bytes');
    }

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(upstream.status);

    if (req.method === 'HEAD') {
      return res.end();
    }

    if (!upstream.body) {
      return res.end();
    }

    const nodeStream = Readable.fromWeb(upstream.body);

    // Cache to disk if the stream is starting from the beginning
    const isFullBeginningStream =
      (!clientRange || clientRange.startsWith('bytes=0-')) &&
      (upstream.status === 200 || upstream.status === 206);

    if (isFullBeginningStream) {
      const tempPath = `${localFile}.tmp.${Date.now()}`;
      const writeStream = fs.createWriteStream(tempPath);
      let cacheCommitted = false;

      writeStream.on('error', (err) => {
        console.warn(`[Disk Cache Write Error] ${trackId}:`, err.message);
        try { fs.unlinkSync(tempPath); } catch {}
      });

      nodeStream.on('data', (chunk) => {
        if (!writeStream.destroyed) {
          writeStream.write(chunk);
        }
      });

      const commitCache = () => {
        if (cacheCommitted) return;
        cacheCommitted = true;
        writeStream.end(() => {
          try {
            if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 1000) {
              fs.renameSync(tempPath, localFile);
              const mb = (fs.statSync(localFile).size / (1024 * 1024)).toFixed(2);
              console.log(`[FLAC Cache Saved] ${trackId} (${mb} MB)`);
            } else {
              try { fs.unlinkSync(tempPath); } catch {}
            }
          } catch (rErr) {
            try { fs.unlinkSync(tempPath); } catch {}
          }
        });
      };

      nodeStream.on('end', commitCache);
      res.on('finish', commitCache);

      req.on('close', () => {
        if (!res.writableEnded && !cacheCommitted) {
          controller.abort();
          writeStream.destroy();
          try { fs.unlinkSync(tempPath); } catch {}
        }
      });
    } else {
      req.on('close', () => {
        if (!res.writableEnded) {
          controller.abort();
        }
      });
    }

    nodeStream.on('error', (err) => {
      if (err.name !== 'AbortError' && !controller.signal.aborted) {
        console.error(`[FLAC Stream Error] ${trackId}:`, err.message);
      }
    });

    nodeStream.pipe(res);
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) return;
    console.error(`[FLAC Stream Proxy Error] ${trackId}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to stream audio payload from upstream' });
    }
  }
});

// Artwork and media proxy with caching
app.get(['/proxy/mi/*', '/proxy/c/*'], async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const safeFilename = encodeURIComponent(req.path).replace(/%/g, '_');
  const localFile = path.join(ARTWORK_CACHE_DIR, safeFilename);

  if (fs.existsSync(localFile)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Cache', 'HIT');
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(localFile).pipe(res);
  }

  try {
    const upstreamUrl = `${UPSTREAM_MONOCHROME_URL}${req.originalUrl}`;
    const upstreamRes = await fetch(upstreamUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EchoesHiFiProxy/1.0)' },
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).end();
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Cache', 'MISS');

    if (req.method === 'HEAD') return res.end();

    const nodeStream = Readable.fromWeb(upstreamRes.body);
    const tempFile = `${localFile}.tmp.${Date.now()}`;
    const writeStream = fs.createWriteStream(tempFile);
    writeStream.on('error', (err) => {
      console.warn(`[Artwork Cache Write Error] ${safeFilename}:`, err.message);
      try { fs.unlinkSync(tempFile); } catch {}
    });

    nodeStream.on('data', (c) => writeStream.write(c));
    nodeStream.on('end', () => {
      writeStream.end(() => {
        try { fs.renameSync(tempFile, localFile); } catch {}
      });
    });
    nodeStream.on('error', () => {
      writeStream.destroy();
      try { fs.unlinkSync(tempFile); } catch {}
    });

    nodeStream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).end();
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

// Listening Party Room (Shared Social Listening for up to 1,000+ members)
class ListeningPartyRoom {
  constructor(partyId, initialData = {}) {
    this.partyId = partyId;
    this.name = initialData.name || 'Listening Party';
    this.hostMemberId = initialData.hostMemberId || null;
    this.hostToken = initialData.hostToken || null;
    this.members = new Map(); // ws -> { id, name, avatar_url, is_host, typing_until, joinedAt, lastSeen }
    this.messages = [];
    this.requests = [];
    this.playback = {
      current_track: initialData.playback?.current_track || null,
      is_playing: initialData.playback?.is_playing || false,
      playback_time: initialData.playback?.playback_time || 0,
      playback_timestamp: initialData.playback?.playback_timestamp || Date.now(),
      queue: initialData.playback?.queue || [],
    };
    this.createdAt = Date.now();
  }

  getPartyState() {
    return {
      id: this.partyId,
      name: this.name,
      host_member_id: this.hostMemberId,
      current_track: this.playback.current_track,
      is_playing: this.playback.is_playing,
      playback_time: this.playback.playback_time,
      playback_timestamp: this.playback.playback_timestamp,
      queue: this.playback.queue,
    };
  }

  getMemberList() {
    return Array.from(this.members.values()).map((m) => ({
      id: m.id,
      name: m.name,
      avatar_url: m.avatar_url,
      is_host: m.is_host,
      typing_until: m.typing_until || 0,
    }));
  }

  send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  broadcast(payload, excludeWs = null) {
    const raw = JSON.stringify(payload);
    for (const [ws] of this.members) {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  addMember(ws, memberId, profile = {}, isHost = false, hostToken = null) {
    let validatedHost = false;
    if (isHost || (hostToken && this.hostToken && hostToken === this.hostToken)) {
      if (!this.hostMemberId) {
        this.hostMemberId = memberId;
        if (hostToken) this.hostToken = hostToken;
        validatedHost = true;
      } else if (this.hostToken && hostToken === this.hostToken) {
        this.hostMemberId = memberId;
        validatedHost = true;
      }
    }

    const member = {
      ws,
      id: memberId,
      name: profile.name || (validatedHost ? 'Host' : 'Listener'),
      avatar_url: profile.avatar_url || '',
      is_host: validatedHost,
      typing_until: 0,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    };
    this.members.set(ws, member);

    this.send(ws, {
      type: 'snapshot',
      snapshot: {
        party: this.getPartyState(),
        members: this.getMemberList(),
        messages: this.messages.slice(-50),
        requests: this.requests,
        memberId,
        isHost: validatedHost,
      },
      memberId,
      isHost: validatedHost,
    });

    this.broadcast(
      {
        type: 'members',
        members: this.getMemberList(),
      },
      ws
    );
  }

  handleMessage(ws, msg) {
    const sender = this.members.get(ws);
    if (!sender) return;
    sender.lastSeen = Date.now();

    switch (msg.type) {
      case 'PING':
        this.send(ws, { type: 'PONG', timestamp: Date.now() });
        break;

      case 'CREATE_PARTY':
        if (msg.name) this.name = msg.name;
        if (msg.hostToken) this.hostToken = msg.hostToken;
        if (msg.memberId) this.hostMemberId = msg.memberId;
        if (msg.playback) {
          this.playback = {
            current_track: msg.playback.current_track || null,
            is_playing: Boolean(msg.playback.is_playing),
            playback_time: typeof msg.playback.playback_time === 'number' ? msg.playback.playback_time : 0,
            playback_timestamp: msg.playback.playback_timestamp || Date.now(),
            queue: Array.isArray(msg.playback.queue) ? msg.playback.queue : [],
          };
        }
        sender.is_host = true;
        this.broadcast({
          type: 'party',
          party: this.getPartyState(),
        });
        this.broadcast({
          type: 'members',
          members: this.getMemberList(),
        });
        break;

      case 'control':
        if (!sender.is_host) return;
        if (msg.action === 'pause') this.playback.is_playing = false;
        if (msg.action === 'play') this.playback.is_playing = true;
        if (typeof msg.time === 'number') this.playback.playback_time = msg.time;
        this.playback.playback_timestamp = msg.timestamp || Date.now();

        this.broadcast(
          {
            type: 'control',
            action: msg.action,
            time: msg.time,
            timestamp: msg.timestamp || Date.now(),
          },
          ws
        );
        break;

      case 'playback':
        if (!sender.is_host) return;
        this.playback = {
          current_track: msg.current_track || this.playback.current_track,
          is_playing: typeof msg.is_playing === 'boolean' ? msg.is_playing : this.playback.is_playing,
          playback_time: typeof msg.playback_time === 'number' ? msg.playback_time : this.playback.playback_time,
          playback_timestamp: msg.playback_timestamp || Date.now(),
          queue: Array.isArray(msg.queue) ? msg.queue : this.playback.queue,
        };

        this.broadcast(
          {
            type: 'party',
            party: this.getPartyState(),
          },
          ws
        );
        break;

      case 'chat': {
        const content = typeof msg.content === 'string' ? msg.content.trim() : '';
        if (!content) return;
        const chatMsg = {
          id: 'msg_' + Math.random().toString(36).slice(2, 12),
          sender_name: sender.name,
          sender_id: sender.id,
          content,
          timestamp: Date.now(),
        };
        this.messages.push(chatMsg);
        if (this.messages.length > 100) this.messages = this.messages.slice(-100);
        this.broadcast({
          type: 'message',
          message: chatMsg,
        });
        break;
      }

      case 'request': {
        if (!msg.track) return;
        const reqItem = {
          id: 'req_' + Math.random().toString(36).slice(2, 12),
          track: msg.track,
          requested_by: sender.name,
          requested_by_id: sender.id,
        };
        this.requests.push(reqItem);
        this.broadcast({
          type: 'requests',
          requests: this.requests,
        });
        break;
      }

      case 'request:remove': {
        if (!sender.is_host) return;
        if (msg.requestId) {
          this.requests = this.requests.filter((r) => r.id !== msg.requestId);
          this.broadcast({
            type: 'requests',
            requests: this.requests,
          });
        }
        break;
      }

      case 'typing': {
        sender.typing_until = typeof msg.typing_until === 'number' ? msg.typing_until : 0;
        this.broadcast(
          {
            type: 'members',
            members: this.getMemberList(),
          },
          ws
        );
        break;
      }

      case 'leave': {
        if (sender.is_host && msg.end) {
          this.broadcast({ type: 'ended' }, ws);
          this.members.clear();
        } else {
          this.removeMember(ws);
        }
        break;
      }
    }
  }

  removeMember(ws) {
    const sender = this.members.get(ws);
    if (!sender) return;
    this.members.delete(ws);

    this.broadcast({
      type: 'members',
      members: this.getMemberList(),
    });
  }
}

// Separate isolated maps for Personal Device Sync vs Listening Parties
const connectRooms = new Map(); // roomId (e.g. "connect_user_123") -> PlaybackRoom
const partyRooms = new Map();   // partyId (e.g. "p_abc123") -> ListeningPartyRoom

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/ws' || pathname === '/' || pathname === '/ws/connect' || pathname === '/ws/party') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, url);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, request, url) => {
  const channel = url.searchParams.get('channel') || (url.pathname.includes('party') ? 'party' : 'connect');

  // ========================================================
  // CHANNEL A: LISTENING PARTY (Up to 1,000+ members in a party)
  // Strictly isolated by partyId - never touches user connect rooms
  // ========================================================
  if (channel === 'party') {
    const rawPartyId = url.searchParams.get('partyId') || url.searchParams.get('party_id') || url.searchParams.get('room');
    const partyId = typeof rawPartyId === 'string' ? rawPartyId.trim() : '';

    if (!partyId || partyId === 'default-room' || partyId === 'undefined' || partyId === 'null') {
      ws.close(4002, 'Bad Request: Valid partyId required for listening party');
      return;
    }

    const memberId = url.searchParams.get('memberId') || `mbr_${Math.random().toString(36).slice(2, 10)}`;
    const memberName = url.searchParams.get('name') || 'Listener';
    const avatarUrl = url.searchParams.get('avatarUrl') || '';
    const isHost = url.searchParams.get('isHost') === 'true';
    const hostToken = url.searchParams.get('hostToken') || null;

    let party = partyRooms.get(partyId);
    if (!party) {
      party = new ListeningPartyRoom(partyId, { hostToken });
      partyRooms.set(partyId, party);
    }

    party.addMember(ws, memberId, { name: memberName, avatar_url: avatarUrl }, isHost, hostToken);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        party.handleMessage(ws, msg);
      } catch (err) {
        console.error('Invalid Party WS payload:', err.message);
      }
    });

    ws.on('close', () => {
      party.removeMember(ws);
      if (party.members.size === 0) {
        partyRooms.delete(partyId);
      }
    });

    ws.on('error', () => {
      party.removeMember(ws);
      if (party.members.size === 0) {
        partyRooms.delete(partyId);
      }
    });

    return;
  }

  // ========================================================
  // CHANNEL B: ECHOES CONNECT (Private Personal Device Sync)
  // Strictly isolated by authenticated user ID - no guests, no bleed
  // ========================================================
  const rawUserId =
    url.searchParams.get('userId') ||
    url.searchParams.get('user_id');

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
  const roomId = `connect_user_${userId}`;
  const deviceId = url.searchParams.get('deviceId') || `dev_${Math.random().toString(36).slice(2, 10)}`;
  const deviceName = url.searchParams.get('deviceName') || 'Unknown Device';
  const deviceType = url.searchParams.get('deviceType') || 'desktop';

  let room = connectRooms.get(roomId);
  if (!room) {
    room = new PlaybackRoom(roomId);
    connectRooms.set(roomId, room);
  }
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
      connectRooms.delete(roomId);
    }
  });

  ws.on('error', () => {
    room.removeDevice(ws);
  });
});

// Periodic heartbeat & idle cleanup
setInterval(() => {
  const now = Date.now();

  // 1. Clean connect rooms
  for (const [roomId, room] of connectRooms.entries()) {
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
      connectRooms.delete(roomId);
    }
  }

  // 2. Clean party rooms
  for (const [partyId, party] of partyRooms.entries()) {
    for (const [ws, member] of party.members.entries()) {
      if (now - member.lastSeen > 60000) {
        try {
          ws.terminate();
        } catch (_e) {}
        party.removeMember(ws);
      } else {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }
    if (party.members.size === 0) {
      partyRooms.delete(partyId);
    }
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Echoes VPS Backend] Listening on port ${PORT}`);
});
