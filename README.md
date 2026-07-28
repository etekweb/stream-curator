# Stream Curator

Multi-platform streamer dashboard. Track streamers across **Twitch**, **Kick**, **YouTube**, **Rumble**, and **X**, with weekly schedules, embedded players, and side-by-side chats.

## Stack

- **Frontend:** Vue 3 (Composition API) + TypeScript + Vite
- **Backend:** Node.js + Express + TypeScript
- **Database:** MySQL

## Setup

1. Copy env and fill credentials:

```bash
cp .env.example .env
```

2. Create the database (prompts for MySQL root password if needed):

```bash
npm run db:setup
```

3. Install and run:

```bash
npm install
npm run dev
```

- App: **https://localhost:5175** (self-signed HTTPS via Vite)  
- API: http://localhost:3002  

Accept the browser cert warning once.

### Twitch embeds on LAN (nip.io)

1. **`parent` must be a real domain** — e.g. `10.0.0.232.nip.io`, not a raw IP.  
2. **HTTPS is required** for non-`localhost` parents (dev server already uses HTTPS).  
3. **Port 443 is ideal for Twitch** — their CSP is `frame-ancestors https://your.host` with no port, so non-443 ports often still block embeds. For local Twitch testing, prefer `https://localhost:5175` (`parent=localhost`).

Optional override:

```bash
VITE_DEV_PORT=443 npm run dev -w client   # may need elevated privileges
```

## Features

- Add streamers with per-platform usernames
- Weekly live schedule (hour ranges per day)
- Platform tabs with embedded players (where supported)
- Embedded chat (Twitch; others open/pop out when embeds are limited)
- Multi-chat side-by-side view
- Pop-out windows for stream or chat per platform
