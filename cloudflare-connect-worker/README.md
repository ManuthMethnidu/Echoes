# Echos Connect - Serverless Spotify Connect Edge Worker

A serverless edge WebSocket synchronization backend built with **Cloudflare Workers** and **Durable Objects**. Enables real-time connected device discovery, remote playback control, and instant handover across Smart TVs, phones, tablets, and desktop browsers for **Echos**.

---

## 🚀 Key Architectural Advantages (Why Cloudflare Workers + Durable Objects?)

1. **Stateful In-Memory Edge Actor:**
   - Unlike stateless message buses (Supabase Realtime Broadcast), Cloudflare Durable Objects maintain the current playback state (active track, volume, and clock-drift-compensated timestamp) **in edge memory**.
   - When a Smart TV turns on, it connects to its room and **instantly receives the current active song and millisecond timestamp** without waiting for a phone heartbeat or querying a database.
2. **Sub-50ms Global WebSocket Latency:**
   - WebSocket connections terminate at the nearest Cloudflare PoP (over 300 locations worldwide). Tapping "Pause" or "Next" on your phone feels instantaneous on the TV.
3. **Smart TV Firewall / NAT Immunity:**
   - Direct P2P WebRTC frequently fails on smart TVs, mobile networks, and home routers without expensive TURN relay servers. Standard WebSockets over port 443 traverse every firewall and TV browser effortlessly.
4. **Zero Persistent Server Costs:**
   - No VPS, no Docker container, no Redis instance to manage. Runs entirely on Cloudflare's serverless edge.

---

## 🛠 Deployment (1 Command)

### 1. Login to Cloudflare
```bash
npx wrangler login
```

### 2. Deploy to Production
```bash
cd cloudflare-connect-worker
npx wrangler deploy
```

After deployment, Wrangler will output your worker URL:
```text
https://echos-connect-worker.<your-subdomain>.workers.dev
```

### 3. Connect to Echos
Add the Worker URL to your Vercel / `.env.local` environment:
```env
VITE_CONNECT_WS_URL=wss://echos-connect-worker.<your-subdomain>.workers.dev/ws
```
or in your browser console / settings:
```javascript
localStorage.setItem('echos-connect-ws-url', 'wss://echos-connect-worker.<your-subdomain>.workers.dev/ws');
```

---

## 📡 WebSocket Protocol Specification

### Connection
```text
wss://<worker-url>/ws?userId=<userId>&deviceId=<deviceId>&deviceName=Smart%20TV&deviceType=tv
```

### Message Types
| Direction | Type | Description |
|-----------|------|-------------|
| Server → Client | `SESSION_STATE` | Sent immediately on connect with room devices, active device, current track & position |
| Client → Server | `PLAYBACK_STATE` | Active device reports play/pause/seek/track events |
| Server → Client | `REMOTE_STATE_UPDATE` | Relayed to non-playing devices so remote controls mirror live playback |
| Client → Server | `TRANSFER_PLAYBACK` | Request to shift playback to another device (`targetDeviceId`) |
| Server → Client | `LOAD_AND_PLAY` | Sent to new active device to start audio at exact timestamp |
| Server → Client | `PAUSE_LOCAL` | Sent to previous active device to silence local output |
| Client → Server | `REMOTE_COMMAND` | Controller sends `PLAY`, `PAUSE`, `SEEK`, `NEXT`, `PREV`, `VOLUME` |
| Server → Client | `EXECUTE_COMMAND` | Delivered to active player to execute immediately |
