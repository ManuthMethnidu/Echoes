# Streaming & API Instances

Echoes streams high-fidelity lossless audio and metadata using community HiFi streaming endpoints.

---

## Echoes Deployments

- **Production**: Deployed via Vercel / Cloudflare Pages.
- **Local**: `http://localhost:3000`

---

## Community Audio & Streaming Endpoints

Echoes uses resilient fallback tiers across available lossless audio instances:

| Provider          | URL                             | Notes                                   |
| ----------------- | ------------------------------- | --------------------------------------- |
| **Tracks Engine** | `https://tracks.monochrome.st`  | Primary FLAC / HiFi resolution backend  |
| **Lucida (QQDL)** | `https://wolf.qqdl.site`        | Community failover endpoint             |
|                   | `https://maus.qqdl.site`        | Community failover endpoint             |
|                   | `https://vogel.qqdl.site`       | Community failover endpoint             |
|                   | `https://katze.qqdl.site`       | Community failover endpoint             |
|                   | `https://hund.qqdl.site`        | Community failover endpoint             |
| **Kinoplus**      | `https://tidal.kinoplus.online` | Community failover endpoint             |
