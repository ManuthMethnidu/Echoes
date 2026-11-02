# echos - Modern Streaming Music Web App

**echos** is a sleek, privacy-focused, ad-free music streaming app engineered for serverless deployment on **Vercel** with **100% client-side audio storage**, **cross-device cloud synchronization** powered by **Neon Serverless Postgres & Better Auth**, **Spotify Connect-like edge device handover** powered by **Cloudflare Durable Objects**, and a **YouTube Music / ArchiveTune-style music discovery and streaming engine**.

---

## 🔑 Your New Neon Database & Vercel API Keys

These are the exact environment variables configured for your new Neon project (**`echos`** / `curly-hall-22232531`):

Copy and paste these into your **Vercel Project Settings ➔ Environment Variables**:

| Variable Name | Value | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://neondb_owner:npg_G8xdrRjXI4nz@ep-small-mouse-a11jp1gr-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require` | Pooled Postgres connection string |
| `POSTGRES_URL` | `postgresql://neondb_owner:npg_G8xdrRjXI4nz@ep-small-mouse-a11jp1gr-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require` | Direct Postgres connection string |
| `NEON_AUTH_BASE_URL` | `https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth` | Neon Better Auth endpoint |
| `NEON_AUTH_JWKS_URL` | `https://ep-small-mouse-a11jp1gr.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth/.well-known/jwks.json` | JWKS endpoint for token validation |
| `AUTH_SECRET` | `9f7a3d1c8e2b5a4f6d0e8c7b9a1f3e5d7c9b1a3e5f7d9b1c3a5e7f9d1b3c5e7a` | Secret key for signing session JWTs |
| `JWT_SECRET` | `9f7a3d1c8e2b5a4f6d0e8c7b9a1f3e5d7c9b1a3e5f7d9b1c3a5e7f9d1b3c5e7a` | Secret key for pairing verification |

*(Optional for YouTube Account Integration via Google OAuth):*
* `GOOGLE_CLIENT_ID`: Your Google OAuth 2.0 Web Client ID
* `GOOGLE_CLIENT_SECRET`: Your Google OAuth 2.0 Client Secret
* Authorized redirect URI in Google Cloud Console: `https://<your-vercel-domain>/api/auth/callback`

---

## 📺 YouTube Playlist Import with Google Sign-In & Neon Better Auth

### How it Works:
1. **Google OAuth with YouTube Scopes:**
   When signing in with Google, Echos requests the standard profile scope plus:
   `https://www.googleapis.com/auth/youtube.readonly`
2. **Access Token Storage in Neon:**
   Neon Better Auth stores the Google access token in `neon_auth.account` under `accessToken`.
3. **Automatic Playlist Sync:**
   Echos calls `/api/yt/user-playlists`:
   - Retrieves the user's Google token directly from `neon_auth.account` using their authenticated session.
   - Fetches their personal YouTube playlists (including Liked Music) via YouTube Data API v3.
   - Allows 1-click import into their Echos library!

---

## ⚡ Spotify Connect (Cloudflare Worker + Durable Objects)

The project includes a serverless WebSocket edge worker in [`cloudflare-connect-worker/`](./cloudflare-connect-worker/):
- **Zero server management**: Runs on Cloudflare's free edge network.
- **In-memory actor state**: When a TV connects, it immediately receives the currently playing track and timestamp without waiting.
- **Instant handover**: Switch playback between phone, TV, and desktop at the exact millisecond.

### Deploy the Worker:
```bash
cd cloudflare-connect-worker
npx wrangler deploy
```

---

## 🚀 Running Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

3. **Run integration test suite:**
   ```bash
   npx tsx test-vercel-endpoints.js
   ```
