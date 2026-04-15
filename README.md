# OpenCode Routines

A self-hosted, open-source alternative to [Claude Code routines](https://code.claude.com/docs/en/routines). Run any agent, any model, as often as you want — on your own infrastructure.

## Why this exists

Claude Code announced [routines](https://code.claude.com/docs/en/routines) — save a prompt, pick a trigger, let it run. Cool concept, but you're locked into their platform, their scheduling limits, and their supported models.

OpenCode Routines gives you that. Point it at any LLM provider that [OpenCode](https://opencode.ai) supports (Anthropic, OpenAI, Google, Minimax, etc.), schedule it however you want, and watch the output stream in real time from a simple web UI.

## What it does

- **Scheduled runs** — cron triggers with presets (every 5 min, daily at 9am, custom expressions)
- **API triggers** — fire routines via HTTP POST from your monitoring, deploy pipeline, or internal tools
- **Multi-provider** — use whatever model you want, from any provider OpenCode supports
- **Live streaming** — watch runs in real time via SSE
- **Run history** — full logs, exit codes, and metadata for every execution
- **Environment management** — global and per-routine env vars for API keys and secrets

Fully containerised — unlike Claude's routines, the agent can only access the files you explicitly mount. Nothing else on your machine is exposed.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (includes `docker compose`)

## Quick Start

```bash
docker compose up --build
```

Open **http://localhost:8080**, create a routine, pick a trigger, done.

## Coming Soon

- **GitHub triggers** — react to pushes, PRs, issues, and other repo events
- **Slack integration** — post run summaries and trigger routines from Slack
- **Run cost analytics**
- **Email notifications**

## License

MIT
