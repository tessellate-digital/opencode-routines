# OpenCode Routines

A self-hosted, open-source alternative to [Claude Code routines](https://code.claude.com/docs/en/routines). Run any agent, any model, as often as you want — on your own infrastructure.

## Why this exists

Claude Code announced [routines](https://code.claude.com/docs/en/routines) — save a prompt, pick a trigger, let it run. Cool concept, but you're locked into their platform, their scheduling limits, and their supported models.

OpenCode Routines gives you that. Point it at any LLM provider that [OpenCode](https://opencode.ai) supports (Anthropic, OpenAI, Google, Minimax, etc.), schedule it however you want, and watch the output stream in real time from a simple web UI.

## What you can build

**Auto-organise your media library**
Drop a movie file into a folder → the agent parses the filename, fetches metadata from IMDB, populates tags, and renames the file to a consistent format. No manual tagging ever again.

**Keep documentation in sync with your API**
Watch three OpenAPI spec files across different folders. Every morning, and every time one of them changes, re-generate the corresponding docs automatically.

**Any agent task, on your files, on your schedule** — the agent can read, write, and transform anything in the folders you mount. You stay in control of what's exposed.

## What it does

- **Filesystem triggers** — watch folders for file changes, creations, and deletions
- **Scheduled runs** — cron triggers with presets (every 5 min, daily at 9am, custom expressions)
- **API triggers** — fire routines via HTTP POST from any external tool or script
- **Multi-provider** — use whatever model OpenCode supports (Anthropic, OpenAI, Google, Minimax, and more)
- **Live streaming** — watch runs in real time via SSE
- **Run history** — full logs, exit codes, and metadata for every execution
- **Environment management** — per-routine env vars for API keys and secrets

Fully containerised — the agent can only access the files you explicitly mount. Nothing else on your machine is exposed.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (includes `docker compose`)
- [Node.js](https://nodejs.org/) 18+ (for the host agent)

## Quick Start

```bash
npm install
npm run up
```

`npm run up` runs `start.sh`, which builds and starts the Docker stack and launches the host agent alongside it. The host agent runs on your machine (outside Docker) so it can watch your local filesystem using native OS events.

Open **http://localhost:8080**, create a routine, pick a trigger, done.

## Mounting local folders

To give routines access to local directories, add bind-mounts to the `backend` service in `docker-compose.yml`:

```yaml
services:
  backend:
    volumes:
      - /path/to/your/project:/workspaces/user-data/project-name
      - /path/to/another:/workspaces/user-data/another-name
```

Each mounted folder appears in the folder picker when creating a routine. The agent can only access directories you explicitly mount — nothing else on your machine is exposed.

## Coming Soon

- **File-type filtering** — filesystem triggers that only fire for specific extensions (e.g. only `.mkv` files, not every change in the folder)
- **Single-file watching** — target a specific file rather than a whole folder
- **Multiple folders per routine** — link one routine to several paths across different projects
- **Multiple triggers per routine** — combine a filesystem watcher with a cron schedule on the same routine (e.g. react to file changes _and_ run every morning)

## License

MIT
