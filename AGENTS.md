# opencode-routines

## Intent Layer

No child `AGENTS.md` nodes are needed — both `backend/src` (~11.5k tokens) and `frontend/src` (~13.6k tokens) are below the 20k threshold.

### Global Invariants

- The backend is the **only** process that talks to SQLite and spawns OpenCode CLI subprocesses.
- The frontend is a pure static SPA — it never connects to the DB and has no server-side logic.
- All inter-service communication in production goes through the nginx reverse proxy (`frontend` container → `backend` container on internal Docker network).
- Never expose the backend port to the host; only the frontend nginx container is public-facing.

---

## Project Overview

**opencode-routines** is a self-hosted automation platform that runs [OpenCode](https://opencode.ai) CLI routines on a schedule or via webhook triggers. It has two independent services:

| Service | Stack | Docker context |
|---|---|---|
| Backend | Node 22, Hono, better-sqlite3, node-cron | repo root (`backend/Dockerfile`) |
| Frontend | React 19, Vite, Tailwind v4, nginx | `./frontend` (`frontend/Dockerfile`) |

**Single command to run everything:**
```bash
docker compose up --build
```
The app is available at `http://localhost:8080`.

---

## Architecture

```
Browser → nginx :80 (frontend container, exposed as :8080)
              ├── /api/*   → proxy → backend:8080 (Hono)
              ├── /hooks/* → proxy → backend:8080 (Hono)
              └── /*       → serve React SPA (try_files fallback)

backend:8080 (Hono)
  ├── SQLite DB at /data/routines.db  (volume: db-data)
  ├── Workspaces dir at /workspaces   (volume: workspaces)
  └── Spawns `opencode` CLI subprocess per routine run
```

### SSE Streaming

The backend pushes live run output over Server-Sent Events:
- `GET /api/events` — global event bus (all runs)
- `GET /api/runs/:id/stream` — per-run output stream

nginx is configured with `proxy_buffering off` to pass SSE through without buffering.

---

## Directory Structure

```
opencode-routines/
├── docker-compose.yml          # Single entrypoint: docker compose up --build
├── .env / .env.example         # Runtime secrets (API keys, config)
│
├── backend/
│   ├── Dockerfile              # Build context: repo root
│   ├── src/
│   │   ├── index.ts            # Hono app, middleware, server start (port 8080)
│   │   ├── config.ts           # Env var config (DATABASE_URL, WORKSPACES_DIR, etc.)
│   │   ├── database.ts         # SQLite init via better-sqlite3
│   │   ├── types.ts            # Shared TypeScript types
│   │   ├── routes/
│   │   │   ├── routines.ts     # CRUD for routines
│   │   │   ├── triggers.ts     # Cron / webhook trigger management
│   │   │   ├── runs.ts         # Run history, per-run SSE stream
│   │   │   ├── webhooks.ts     # GitHub webhook ingestion (HMAC verified)
│   │   │   └── settings.ts     # App-level settings
│   │   └── services/
│   │       ├── executor.ts     # Spawns `opencode` CLI subprocess
│   │       ├── scheduler.ts    # node-cron wrapper for cron triggers
│   │       ├── github.ts       # HMAC verification + event parsing
│   │       └── eventBus.ts     # SSE broadcast to all connected clients
│   └── static/                 # Legacy Vanilla JS fallback (kept as safety net)
│
├── frontend/
│   ├── Dockerfile              # Multi-stage: Vite build → nginx serve
│   ├── nginx.conf              # Reverse proxy config for /api and /hooks
│   ├── vite.config.ts          # Dev proxy: /api + /hooks → localhost:8080
│   └── src/
│       ├── main.tsx / App.tsx  # React Router entry, all page routes
│       ├── components/         # Layout, CronPicker, RunsTable
│       ├── pages/              # Dashboard, RoutinesList, RoutineDetail,
│       │                       # RoutineForm, RunsList, RunDetail, Settings
│       ├── hooks/useSSE.ts     # SSE subscription hook
│       └── lib/
│           ├── api.ts          # Typed fetch API client
│           ├── types.ts        # Shared frontend types
│           └── utils.ts
│
├── package.json                # Backend root: build/dev scripts, tsc output → dist/
├── tsconfig.json               # Backend TypeScript config
└── dist/                       # Compiled backend JS (gitignored, produced by tsc)
```

---

## Development

### Local (hot reload)

```bash
# Terminal 1 — backend
npm run dev          # tsx watch on port 8080

# Terminal 2 — frontend
npm run dev:frontend  # Vite on port 5173, proxies /api + /hooks → 8080
```

### Build scripts (root package.json)

| Script | What it does |
|---|---|
| `npm run dev` | Backend in watch mode (`tsx watch`) |
| `npm run dev:frontend` | Vite dev server with API proxy |
| `npm run build` | Compile backend TypeScript → `dist/` |
| `npm run build:frontend` | Vite build → `frontend/dist/` |
| `npm run build:all` | Both of the above |
| `npm start` | Run compiled backend (`node dist/index.js`) |

---

## Key Patterns

### Adding a new API route

1. Create handler file in `backend/src/routes/`
2. Register it in `backend/src/index.ts`
3. Add request/response types to `backend/src/types.ts`
4. Add a typed fetch helper to `frontend/src/lib/api.ts`

### Adding a new frontend page

1. Create page component in `frontend/src/pages/`
2. Register the route in `frontend/src/App.tsx`
3. Add a nav link in `frontend/src/components/Layout.tsx`

### Environment variables

Defined in `.env` (copy from `.env.example`). Loaded by the backend at startup via `backend/src/config.ts`. The frontend has no runtime env — it talks to the backend via the nginx proxy.
