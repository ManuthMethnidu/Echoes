<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/images/echoes_logo_white.png" />
    <source media="(prefers-color-scheme: light)" srcset="public/images/echoes_logo_black.png" />
    <img src="public/images/echoes_logo_white.png" alt="Echoes Logo" width="140px" style="border-radius: 20px;" />
  </picture>
</p>

<h1 align="center">Echoes</h1>

<p align="center">
  <strong>Clean, ad-free, open-source music streaming client with real-time cross-device sync.</strong>
</p>

<p align="center">
  <a href="https://echoes.mteck.tech">Live Web App</a> |
  <a href="#support-by-starring">Star Repository</a> |
  <a href="#hall-of-fame-and-contributors">Contributors</a> |
  <a href="#donations-and-sponsorship">Donations</a> |
  <a href="#bug-reports-and-feature-requests">Report Issue &amp; Feature Requests</a> |
  <a href="#security-and-responsible-disclosure">Security Policy</a> |
  <a href="#features">Features</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#getting-started">Getting Started</a> |
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active-10b981?style=for-the-badge" alt="Status Active" />
  <img src="https://img.shields.io/badge/Platform-Vercel%20%7C%20Cloudflare-000000?style=for-the-badge&logo=vercel" alt="Platform Vercel Cloudflare" />
  <img src="https://img.shields.io/badge/Database-Neon%20Postgres-00e599?style=for-the-badge&logo=postgresql" alt="Neon Postgres" />
  <img src="https://img.shields.io/badge/License-Apache--2.0-blue?style=for-the-badge" alt="License Apache 2.0" />
</p>

---

## Live Deployment

- Canonical Web Application: https://echoes.mteck.tech
- GitHub Repository: https://github.com/ManuthMethnidu/Echoes
- Issue & Feature Tracker: https://github.com/ManuthMethnidu/Echoes/issues

---

## Support by Starring

Echoes is maintained as a 100% free, open-source community project without advertisements, trackware, or subscription walls.

If you enjoy using Echoes, the single greatest way you can support our continued development is by giving this repository a star:

**Star the repository:** https://github.com/ManuthMethnidu/Echoes

Every star helps more music listeners discover an ad-free, high-fidelity alternative.

---

## Hall of Fame and Contributors

Echoes is developed with immense pride as a 100% free, community-powered open-source project. Immense gratitude to every engineer, designer, translator, and supporter who has contributed code, fixes, and ideas along the journey:

<p align="center">
  <a href="https://github.com/ManuthMethnidu/Echoes/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=ManuthMethnidu/Echoes" alt="Echoes Contributors" />
  </a>
</p>

We welcome contributions of all forms—bug reports, pull requests, lyrics source integrations, audio DSP improvements, and documentation enhancements. Check out our [GitHub Issues](https://github.com/ManuthMethnidu/Echoes/issues) or submit a pull request!

---

## Donations and Sponsorship

Echoes has zero corporate funding or venture backing. All serverless edge compute, Neon PostgreSQL hosting, domain fees (echoes.mteck.tech), and maintenance are funded entirely out of pocket.

If you would like to help cover operational server expenses, sponsor new features, or send a token of appreciation, please contact creator **Manuth Methnidu** directly:

- Contact for Donations: contact.Echoes@proton.me
- Subject line: `Echoes Donation / Sponsorship`

---

## Bug Reports and Feature Requests

Community feedback directly drives the Echoes roadmap. Whether you noticed an audio playback glitch, encountered a bug, or have an exciting idea for a new feature, please submit an issue on GitHub. Please do not email for bug reports or feature requests so that all community issues remain publicly tracked and organized:

- Submit a Bug Report or Feature Request: https://github.com/ManuthMethnidu/Echoes/issues/new/choose
- Feature Request Form: https://github.com/ManuthMethnidu/Echoes/issues/new?template=feature_request.yml
- Bug Report Form: https://github.com/ManuthMethnidu/Echoes/issues/new?template=bug_report.yml

---

## Security and Responsible Disclosure

We prioritize user privacy and defensive engineering. Key security measures implemented in Echoes:
- Database Protection: Neon Serverless PostgreSQL parameterized queries protecting against SQL injection (SQLi).
- SSRF & Proxy Hardening: The audio stream proxy enforces a strict domain allowlist and explicitly blocks private IP ranges (RFC 1918) and cloud metadata services.
- XSS Prevention: Centralized sanitization module (`api/_lib/sanitize.ts`) with safe DOMParser node generation and protocol filtering.
- Reduced Attack Surface: Third-party file uploads have been completely removed in favor of validated HTTPS URLs.
- Device Pairing Defense: High-entropy pairing codes via `crypto.getRandomValues()` combined with brute-force rate limiting.
- HTTP Security Headers: Enforced via edge rules (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).

### Reporting a Security Vulnerability

If you discover a security vulnerability or potential breach in Echoes, please kindly report it responsibly. Please do NOT disclose vulnerabilities publicly in GitHub Issues.

Report directly to maintainer **Manuth Methnidu**:
- Security Contact: contact.Echoes@proton.me
- Subject line: `[SECURITY VULNERABILITY] <Brief description>`

For our complete vulnerability disclosure policy and response commitment, see [SECURITY.md](SECURITY.md).

---

## What is Echoes?

Echoes is a privacy-first, open-source audio streaming player designed for music enthusiasts who demand uncompromising fidelity, clean aesthetics, and cross-device continuity without tracking or subscription paywalls.

Echoes combines high-bitrate audio streaming with a serverless edge architecture: your library seamlessly follows you from your laptop to your phone and your living room TV, complete with real-time remote playback handoff.

---

## Key Features

### High-Fidelity Audio Playback
- Lossless and High-Resolution Streaming: Clean, low-latency playback with automatic multi-instance stream failover.
- Parametric and Graphic Equalizer: Up to 32-band equalizer with AutoEQ headphone profile import support.
- Audio Processing: Gapless playback, ReplayGain loudness normalization, binaural DSP crossfeed, and pitch/speed control.
- Hardware-Accelerated Visualizers: Milkdrop/Butterchurn WebGL shader engine, beat-reactive artwork pulse, and real-time spectrum analysers.

### Universal Lyrics & Multi-Language Translation
- Apple Music Kinetic Typography: Powered by `@uimaxbai/am-lyrics` with fluid kinetic scaling, blur transitions, and synchronized autoscroll.
- Multi-Source Fallback Pipeline: Automated resolution cascading across Musixmatch, LRCLIB, Apple Music TTML, and YouTube Closed Captions.
- Universal YouTube Closed Captions Engine: Automatically retrieves synchronized video captions via serverless edge failover (`/api/yt/captions`) when lyrics providers lack data.
- Real-Time Multi-Language Translation: Translate synchronized lyrics on the fly into 130+ languages (`/api/lyrics/translate`) with dual-subtitles rendered directly beneath active lines.
- Romanized Romaji Mode: One-click transliteration of Japanese kanji/kana lyrics into Romanized Romaji.
- Genius Community Annotations: Interactive deep-dive annotations providing behind-the-scenes song meanings directly from Genius.

### Echoes Connect (Cross-Device Remote Playback)
- Real-Time Edge WebSocket Sync: Backed by Cloudflare Workers and Durable Objects for instantaneous device switching.
- Zero-Latency Playback Handshake: Play, pause, seek, queue reordering, and volume adjustments sync live across all active devices.
- Smart TV QR Pairing: Pair a smart TV or secondary display in seconds by scanning an on-screen QR code (/pair).

### Cross-Device Cloud Library
- Neon Serverless Postgres Sync: Synchronizes liked tracks, custom playlists, folders, and listening history with sub-second latency.
- Seamless Continuity: Pick up playback seamlessly on any desktop browser, mobile PWA, or tablet.
- Complete Data Ownership: Export your entire library at any time in standard JSON formats.

### Playlist Importers
- YouTube Music Playlists: Direct import of personal YouTube playlists via Google OAuth 2.0 (youtube.readonly).
- Spotify Playlist Importer: Rapid parsing of public Spotify playlists into your personal Echoes library without requiring developer API keys.

### Offline Audio Caching & Downloads
- Offline CacheStorage: Caches tracks locally in the browser so that returning users can play cached audio even without internet connectivity.
- Direct Track Exporter: Download tracks, albums, or playlists directly to your local file system with embedded ID3 metadata tags and album artwork.

### Minimalist Aesthetic & Progressive Web App
- Theme Support: Monochromatic, distraction-free aesthetic with automatic dark/light theme switching.
- Installable PWA: Full Progressive Web App support on desktop (Windows, macOS, Linux) and mobile (iOS, Android).

---

## Architecture

Echoes is engineered with an edge-first, decoupled architecture:

```
+--------------------------------------------------------+
|                   Echoes Frontend (PWA)                |
|     (Vite + TypeScript + Web Audio API + Shaka Player) |
+-----------------------+-----------------+--------------+
                        |                 |
              HTTPS REST API (Vercel)     | WebSockets (WSS)
                        |                 |
                        v                 v
        +-------------------------+  +-------------------------+
        |    Vercel Serverless    |  |  Cloudflare Worker + DO |
        |     API Endpoints       |  |     (Echoes Connect)    |
        |   (/api/auth, /api/sync)|  | (Durable Object Rooms)  |
        +-----------+-------------+  +-------------------------+
                    |
                    v
        +-------------------------+
        | Neon Serverless Postgres|
        |  (User profiles, sync,  |
        |  device pairings, auth) |
        +-------------------------+
```

- Frontend: Browser-native execution with Vite, vanilla JavaScript modules, and Web Audio API graph nodes.
- Backend API: Vercel Serverless Functions (@vercel/node) for authentication, cloud library synchronization, TV pairing, and playlist imports.
- Database: Neon Serverless PostgreSQL with connection pooling and parameterization.
- Real-Time Edge: Cloudflare Worker running SQLite-backed Durable Objects managing concurrent playback rooms.

---

## Project Structure

```
├── api/                           # Vercel Serverless API handlers
│   ├── _lib/                      # Database client, auth tokens, input sanitizer, Invidious failover
│   ├── _handlers/                 # Modular API request handlers (auth, sync, pair, yt, lyrics)
│   └── index.ts                   # Unified API router (/api/auth, /api/sync, /api/yt/captions, etc.)
├── cloudflare-connect-worker/     # Cloudflare Worker and Durable Objects backend
│   ├── src/index.ts               # PlaybackRoom DO class and WebSocket server
│   └── wrangler.toml              # Cloudflare Worker configuration
├── js/                            # Core client application logic
│   ├── accounts/                  # Authentication manager and session handlers
│   ├── connect-manager.js         # Echoes Connect edge WebSocket sync client
│   ├── player.js                  # Audio playback engine and queue controller
│   ├── audio-context.js           # Web Audio API DSP and equalizer graphs
│   └── ui.js                      # DOM views, modals, and interaction states
├── public/                        # Static assets, sitemap.xml, robots.txt, icons
└── styles.css                     # Design system and theme variables
```

---

## Getting Started

### Prerequisites

- Node.js v18.0.0 or higher
- npm v9.0.0 or higher
- A free Neon Postgres database instance

### 1. Clone and Install

```bash
git clone https://github.com/ManuthMethnidu/Echoes.git
cd Echoes
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
DATABASE_URL_UNPOOLED=postgresql://user:password@ep-your-database.neon.tech/neondb?sslmode=require

# JWT and Session Signing (minimum 32 random characters)
AUTH_SECRET=your_32_character_super_secret_key_here
JWT_SECRET=your_32_character_super_secret_key_here

# Google OAuth 2.0 (Optional - for Google Sign-In and YouTube Playlist Import)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
```

### 3. Run Development Server

```bash
npm run dev
```

Open your browser at `http://localhost:5173`.

### 4. Build for Production

```bash
npm run build
```

The production assets will be built in the `dist/` directory.

---

## Echoes Connect (Cloudflare Worker)

Echoes Connect synchronizes playback between devices in real-time. The worker source code is located in `cloudflare-connect-worker/`.

### Deployment via Wrangler

```bash
cd cloudflare-connect-worker
npm install
npx wrangler deploy
```

Once deployed:
1. Ensure the `workers.dev` route toggle is enabled in your Cloudflare Dashboard under Workers & Pages > echoes-connect-worker > Settings > Domains & Routes.
2. Test the health endpoint:
   ```bash
   curl https://echoes-connect-worker.methnidumanuth.workers.dev/health
   # Returns: {"service":"echoes-connect-worker","status":"online"}
   ```

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| Space | Play / Pause |
| Right Arrow / Left Arrow | Seek forward / backward 10s |
| Shift + Right Arrow / Shift + Left Arrow | Next / Previous track |
| Up Arrow / Down Arrow | Volume Up / Down |
| M | Mute / Unmute audio |
| S | Toggle Shuffle |
| R | Toggle Repeat mode |
| Q | Open Playback Queue |
| L | Toggle Synchronized Lyrics |
| / | Focus Search Bar |
| Ctrl + K (Cmd + K) | Open Command Palette |
| Esc | Close active modals and panels |

---

## Legal and Contact

- Terms of Service: https://echoes.mteck.tech/tos
- Privacy Policy: https://echoes.mteck.tech/policy
- Direct Inquiries and Donations: contact.Echoes@proton.me
- Creator: Manuth Methnidu

---

## Open Source Credits

Echoes is built upon open-source foundations and community services:
- Monochrome: Foundational web player architecture, UI styling, and Milkdrop visualizer integration.
- ArchiveTune: YouTube Music scraping and stream resolution pipelines.
- Invidious: Federated, privacy-respecting YouTube API and audio stream network.
- Album of the Year (AOTY): Critical consensus, ratings, and album reviews via community APIs.

---

## License

Echoes is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file for complete details.
