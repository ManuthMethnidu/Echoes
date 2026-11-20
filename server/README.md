# Echoes Private Streaming Backend & Lossless Hi-Fi Proxy

A lightweight, dedicated backend service for **Echoes Music Player**.

### Features
* **Lossless FLAC Streaming (`/track/:id`)**: Streams bit-perfect 16-bit / 24-bit audio with native HTTP range request support (`206 Partial Content`).
* **Disk Caching (`/cache/tracks/`)**: Automatically caches streamed FLAC tracks and artwork to your VPS disk. Cached tracks stream locally with zero network latency and immune to third-party rate limits.
* **Catalog & Search Proxy (`/search/tracks`, `/releases/:id`, `/artists/:id`)**: In-memory cached proxy over lossless music catalogs with zero bot challenges.
* **YouTube Stream Fallback (`/yt/:id`)**: Automatic yt-dlp audio extractor using Apple VisionOS player client to bypass YouTube bot blocks on VPS IP ranges.
* **Echoes Connect Device Sync**: WebSocket server for synchronized multi-device playback.

---

## 1. Quick Deploy with Docker Compose (Recommended)

### Requirements
* Any Linux VPS (Ubuntu 20.04+, Debian 11+, Alpine, etc.)
* Docker & Docker Compose installed
* ~50MB RAM usage

### Step 1: Copy `server/` to your VPS
```bash
# On your local machine, rsync or scp the server directory:
rsync -avz --exclude 'node_modules' --exclude 'cache' server/ user@YOUR_VPS_IP:/opt/echoes-backend/
```

### Step 2: Start the Container
```bash
cd /opt/echoes-backend

# Build and run in background
docker compose up -d --build
```

Verify it is running:
```bash
curl http://127.0.0.1:4040/health
```

---

## 2. Setting Up Free HTTPS with Caddy (1 Minute)

Caddy automatically provisions and renews Let's Encrypt SSL certificates.

1. Point a DNS A record (e.g. `stream.yourdomain.com`) to your VPS IP address.
2. Install Caddy:
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install caddy
   ```
3. Copy `server/Caddyfile` to `/etc/caddy/Caddyfile`:
   ```bash
   sudo cp Caddyfile /etc/caddy/Caddyfile
   # Replace stream.yourdomain.com with your actual domain
   sudo nano /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

Your backend is now live with automatic HTTPS at `https://stream.yourdomain.com`!

---

## 3. Alternative: Running directly with PM2 (Without Docker)

```bash
cd /opt/echoes-backend
npm install --omit=dev
sudo npm install -g pm2
pm2 start src/index.js --name echoes-backend
pm2 save
pm2 startup
```

---

## 4. Connecting Echoes Web App to Your VPS

1. Open Echoes in your browser.
2. Go to **Settings** -> **Instances** tab.
3. Locate **Lossless Streaming Server (Private VPS / Monochrome)**.
4. Enter your VPS URL (e.g. `https://stream.yourdomain.com`).
5. Click **Test** (you should see `Online (XXms). Connected successfully`).

All music playback, searches, and artwork will now route through your private VPS!
