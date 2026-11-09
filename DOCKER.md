# Echoes Docker Deployment Guide

## Quick Start

### Echoes Only

```bash
docker compose -f docker/docker-compose.yml up -d
```

Visit `http://localhost:3000`

### Development

```bash
docker compose -f docker/docker-compose.yml --profile dev up -d
```

Visit `http://localhost:5173` (hot-reload enabled)

---

## How It Works

### Profiles

Docker Compose profiles control which services start. A service with no profile always runs. A service with a profile only runs when that profile is activated.

| Command                                                                            | What starts                       |
| ---------------------------------------------------------------------------------- | --------------------------------- |
| `docker compose -f docker/docker-compose.yml up -d`                                | Echoes                            |
| `docker compose -f docker/docker-compose.yml --profile pocketbase up -d`           | Echoes + PocketBase               |
| `docker compose -f docker/docker-compose.yml --profile dev up -d`                  | Echoes + Dev server               |
| `docker compose -f docker/docker-compose.yml --profile dev --profile pocketbase up -d` | Echoes + Dev server + PocketBase  |

In `docker/docker-compose.yml`, it looks like this:

```yaml
services:
    echoes: # no profile -- always starts

    pocketbase:
        profiles: ['pocketbase'] # opt-in

    echoes-dev:
        profiles: ['dev'] # opt-in
```

### Environment Configuration

Copy the example environment configuration to set custom ports or services:

```bash
cp docker/.env.example docker/.env
```

Available variables include:
- `ECHOES_PORT`: Port to map the web interface (default `3000`).
- `ECHOES_DEV_PORT`: Port for the dev server (default `5173`).
- `POCKETBASE_PORT`: Port for PocketBase (default `8090`).
