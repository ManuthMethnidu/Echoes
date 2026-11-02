<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/images/echoes_logo_white.png" />
    <source media="(prefers-color-scheme: light)" srcset="public/images/echoes_logo_black.png" />
    <img src="public/images/echoes_logo_white.png" alt="Echoes Logo" width="140px" style="border-radius: 20px;" />
  </picture>
</p>

<h1 align="center">Echoes</h1>

<p align="center">
  <strong>Minimalist, ad-free music streaming client with real-time cross-device sync.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#echoes-connect">Echoes Connect</a> •
  <a href="#environment-variables">Environment Variables</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a> •
  <a href="#legal--contact">Contact & Legal</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active-10b981?style=for-the-badge" alt="Status Active" />
  <img src="https://img.shields.io/badge/Platform-Vercel%20%7C%20Cloudflare-000000?style=for-the-badge&logo=vercel" alt="Platform Vercel Cloudflare" />
  <img src="https://img.shields.io/badge/Database-Neon%20Postgres-00e599?style=for-the-badge&logo=postgresql" alt="Neon Postgres" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License MIT" />
</p>

---

## What is Echoes?

**Echoes** is a privacy-first, open-source audio streaming player designed for music enthusiasts who demand uncompromising fidelity, clean aesthetics, and cross-device continuity without tracking or subscription paywalls.

Echoes combines high-bitrate audio streaming with a serverless edge architecture: your library seamlessly follows you from your laptop to your phone and your living room TV, complete with real-time Spotify Connect-style remote playback handoff.

---

## Key Features

### 🎧 High-Fidelity Audio Playback
- **Lossless & Hi-Res Streaming:** Crystal clear, low-latency playback with automatic stream fallback.
- **Parametric & Graphic EQ:** 16-band equalizer with AutoEQ headphone profile import support.
- **Audio Processing:** Gapless playback, ReplayGain normalization, binaural DSP crossfeed, and pitch/speed control.
- **Audio Visualizers:** Integrated Milkdrop/Butterchurn WebGL engine, particle fields, and LCD visualizer modes.

### 📱 Echoes Connect (Spotify Connect-Style Remote Control)
- **Real-Time Edge WebSocket Sync:** Backed by **Cloudflare Workers & Durable Objects**, allowing seamless device switching.
- **Zero-Latency State Synchronization:** Play, pause, seek, queue changes, and volume adjustments sync instantly across all active displays.
- **Smart TV QR Pairing:** Pair your television or secondary screen in seconds by scanning an on-screen QR code (`/pair`). No remote typing required.

### ☁️ Cross-Device Cloud Library
- **Neon Serverless Postgres Integration:** Synchronizes your liked songs, albums, custom playlists, and playback history in milliseconds.
- **Device Continuity:** Pick up exactly where you left off on any browser, mobile PWA, or desktop session.
- **Data Ownership:** Export your entire library anytime or bring your own database credentials.

### 🔄 Multi-Platform Playlist Importer
- **YouTube Playlists via Google OAuth:** Direct, secure import of your personal YouTube playlists via Google OAuth 2.0 (`youtube.readonly`).
- **Spotify Playlist Importer:** Instant extraction of public Spotify playlists into your personal Echoes library without requiring developer API keys.

### 💾 Offline Audio Exporter & Caching
- **Direct Track Download:** Download any track, album, or playlist directly to your local device with embedded tags and cover art for offline listening.

### 🎨 Minimalist Aesthetic & Adaptive Branding
- **Theme Support:** Clean, distraction-free monochrome aesthetic with automatic dark/light theme switching and custom user stylesheets.
- **Installable PWA:** Full Progressive Web App support with offline caching and background audio playback.

---

## Architecture

Echoes is engineered with an edge-first, decoupled architecture:

```
┌────────────────────────────────────────────────────────┐
│                   Echoes Frontend (PWA)                │
│     (Vite + TypeScript + Web Audio API + Shaka Player) │
└───────────────────────┬─────────────────┬──────────────┘
                        │                 │
              HTTPS REST API (Vercel)     │ WebSockets (WSS)
                        │                 │
                        ▼                 ▼
        ┌─────────────────────────┐  ┌─────────────────────────┐
        │    Vercel Serverless    │  │  Cloudflare Worker + DO │
        │     API Endpoints       │  │     (Echoes Connect)    │
        │   (/api/auth, /api/sync)│  │ (Durable Object Rooms)  │
        └───────────┬─────────────┘  └─────────────────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │ Neon Serverless Postgres│
        │  (User profiles, sync,  │
        │  device pairings, auth) │
        └─────────────────────────┘
```

- **Frontend:** Pure browser performance with Vite, Preact UI components, and native Web Audio graph nodes.
- **Backend API:** Vercel Node.js Serverless Functions (`/api/sync`, `/api/auth`, `/api/pair`, `/api/yt`, `/api/import`).
- **Database:** [Neon](https://neon.tech) Serverless PostgreSQL using connection pooling and schema migrations.
- **Real-Time Edge:** Cloudflare Worker running SQLite-backed Durable Objects managing concurrent playback rooms.

---

## Project Structure

```
├── api/                           # Vercel Serverless API handlers
│   ├── _lib/                      # Database client, auth tokens, QR generation
│   ├── auth/                      # Authentication (Google OAuth, email, session)
│   ├── pair/                      # TV QR-code device pairing endpoints
│   ├── sync/                      # Neon Postgres cloud library sync (GET/PATCH)
│   ├── yt/                        # YouTube stream resolution & playlist import
│   └── import/                    # Spotify zero-key playlist parser
├── cloudflare-connect-worker/     # Cloudflare Worker + Durable Objects backend
│   ├── src/index.ts               # PlaybackRoom DO class & WebSocket server
│   └── wrangler.toml              # Cloudflare Worker configuration
├── js/                            # Core client application logic
│   ├── accounts/                  # Auth manager & Better Auth client
│   ├── connect-manager.js         # Echoes Connect edge WebSocket sync client
│   ├── player.js                  # Audio playback engine & queue controller
│   ├── audio-context.js           # Web Audio API DSP & EQ graphs
│   └── ui.js                      # DOM views, modals, and interaction states
├── public/                        # Static assets, SVG icons, adaptive favicons
├── src/                           # Modern navigation & Preact components
└── styles.css                     # Minimalist design system & theme variables
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18.0.0 or higher
- [npm](https://www.npmjs.com/) v9.0.0 or higher
- A free [Neon](https://neon.tech) Postgres account

### 1. Clone & Install

```bash
git clone https://github.com/ManuthMethnidu/echos.git
cd echos
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory (refer to `.env.example`):

```bash
cp .env.example .env.local
```

Populate the required environment variables:

```env
# Neon Serverless Postgres Connection String
DATABASE_URL=postgresql://user:password@ep-your-database-pooler.neon.tech/neondb?sslmode=require
POSTGRES_URL=postgresql://user:password@ep-your-database-pooler.neon.tech/neondb?sslmode=require

# JWT and Session Signing (minimum 32 random characters)
AUTH_SECRET=your_32_character_super_secret_key_here
JWT_SECRET=your_32_character_super_secret_key_here

# Google OAuth 2.0 (Optional - for Google Sign-In & YouTube Import)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
```

### 3. Run Development Server

```bash
npm run dev
```

Open your browser at `http://localhost:5173`.

### 4. Run Integration Tests

Verify that all database connections, pairing APIs, Spotify extractors, and auth endpoints work:

```bash
npx tsx test-vercel-endpoints.js
```

---

## Echoes Connect (Cloudflare Worker)

Echoes Connect synchronizes playback between devices in real-time. The worker source code is located in [`cloudflare-connect-worker/`](cloudflare-connect-worker/).

### Deployment via Wrangler

```bash
cd cloudflare-connect-worker
npm install
npx wrangler deploy
```

Once deployed:
1. Ensure the `workers.dev` route toggle is enabled in your [Cloudflare Dashboard](https://dash.cloudflare.com/) under **Workers & Pages** > **`echoes-connect-worker`** > **Settings** > **Domains & Routes**.
2. Test the health endpoint:
   ```bash
   curl https://echoes-connect-worker.methnidumanuth.workers.dev/health
   # → {"service":"echoes-connect-worker","status":"online"}
   ```

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `→` / `←` | Seek forward / backward 10s |
| `Shift` + `→` / `Shift` + `←` | Next / Previous track |
| `↑` / `↓` | Volume Up / Down |
| `M` | Mute / Unmute audio |
| `S` | Toggle Shuffle |
| `R` | Toggle Repeat mode |
| `Q` | Open Playback Queue |
| `L` | Toggle Synchronized Lyrics |
| `/` | Focus Search Bar |
| `Ctrl` + `K` (`Cmd` + `K`) | Open Command Palette |
| `Esc` | Close active modals & panels |

---

## Legal & Contact

- **Terms of Service:** [`/tos`](https://echos.vercel.app/tos)
- **Privacy Policy:** [`/policy`](https://echos.vercel.app/policy)
- **Direct Contact:** [`contact.Echoes@proton.me`](mailto:contact.Echoes@proton.me)

For bug reports, feature requests, or DMCA copyright inquiries, please contact us directly at **contact.Echoes@proton.me**.

---

<p align="center">
  <strong>Echoes</strong> — Crafted for pure sound and focused listening.
</p>
