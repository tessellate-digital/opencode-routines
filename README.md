# OpenCode Routines

A self-hosted automation platform that runs [OpenCode](https://opencode.ai) tasks on a schedule, via API webhooks, or in response to GitHub events. Inspired by [Claude Code's routines feature](https://code.claude.com/docs/en/routines), but fully open-source and running on your own infrastructure.

**What it does:** Save a prompt, a trigger, and an LLM provider. OpenCode Routines automatically runs your prompt at the specified time or event, captures the output, and stores it in a searchable history.

## Features

- **Web UI** — dashboard for creating, managing, and monitoring routines with live logs
- **Scheduled triggers (cron)** — run routines on any recurring schedule (hourly, daily, custom cron expressions)
- **API triggers** — fire routines via HTTP POST with bearer token authentication
- **GitHub triggers** — react to repository events (push, PR opened, issues, releases, etc.)
- **Live output streaming** — watch runs in real time via Server-Sent Events (SSE)
- **Multi-provider LLM support** — use Anthropic, OpenAI, Google, Minimax, or any provider OpenCode supports
- **Git integration** — automatically clones and updates repositories before each run
- **Environment management** — global and per-routine environment variables for API keys and configuration
- **Run history** — view all past runs with full logs, exit codes, and metadata
- **JSON event parsing** — clean, readable output from OpenCode's raw event stream (removes boilerplate)

## Architecture

Everything runs in a single Docker container:

- **FastAPI** backend (REST API, scheduler, webhook handler, OpenCode executor)
- **SQLite** database (routines, triggers, run history, settings)
- **APScheduler** for cron trigger scheduling
- **OpenCode CLI** (invoked as subprocess for each run)
- **Vanilla JS + Tailwind** frontend SPA (served as static files)

Data persistence uses two Docker volumes:
- `db-data` — SQLite database at `/data/routines.db`
- `workspaces` — cloned git repositories and run working directories at `/workspaces/`

## Quick Start

### 1. Clone and configure

```bash
cd opencode-routines
cp .env.example .env
```

Edit `.env` with your LLM provider API keys. You need at least one:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

Optional: set a default model and admin token:

```env
OPENCODE_MODEL=opencode/minimax-m2.5-free
ADMIN_TOKEN=your-secret-bearer-token
```

### 2. Start the service

```bash
docker compose up --build
```

The web UI is at **http://localhost:8080**.

### 3. Create your first routine

1. Click **New Routine**
2. Enter a name and prompt (e.g., "List all open issues in the repo and summarize by priority")
3. Select a model from the dropdown (defaults to `opencode/minimax-m2.5-free`)
4. Choose a trigger:
   - **None** — manual triggering only (use "Run Now" button)
   - **Cron** — schedule with a preset (every 5 min, daily at 9am, etc.) or custom cron expression
   - **GitHub** — provide repo URL, branch, and event type (push, PR opened, issues, etc.)
5. Click **Create**
6. Watch it run on the dashboard or click to view detailed logs

## Usage

### Creating Routines

A routine consists of:
- **Name & Description** — what the routine does
- **Prompt** — the instruction OpenCode executes (can be multi-line)
- **Model** — LLM to use (dropdown auto-populated from `opencode models`)
- **Agent** — OpenCode agent type (default: `build`)
- **Trigger** — when/how it runs (see below)
- **Environment Variables** — JSON dict of env vars specific to this routine (override globals)
- **Enabled** — toggle to pause/resume without deleting

### Triggers

Each routine can have one or more triggers. Add them during creation or edit the routine later.

#### Cron Triggers

Schedule-based execution using standard cron expressions. Choose a preset or enter a custom expression:

| Preset | Expression |
|--------|------------|
| Every minute | `* * * * *` |
| Every 5 minutes | `*/5 * * * *` |
| Every hour | `0 * * * *` |
| Daily at 9am | `0 9 * * *` |
| Weekdays at 9am | `0 9 * * 1-5` |
| Weekly (Sunday midnight) | `0 0 * * 0` |
| Monthly (1st at midnight) | `0 0 1 * *` |

Runs execute on Anthropic-managed cloud infrastructure, so they continue even if your laptop is closed.

#### GitHub Triggers

React to repository events. Requires:
- **Repository URL** — the GitHub repo to monitor (e.g., `https://github.com/anthropics/claude-code`)
- **Branch** — which branch to monitor
- **Event** — what triggers the run (push, `pull_request.opened`, `issues.opened`, etc.)

When a matching event occurs, OpenCode receives the event metadata (author, commit SHA, PR number, etc.) and appends it to your prompt as context.

Example use case: on every `pull_request.opened`, run a code review routine that checks for security issues.

#### API Triggers

Trigger a routine via HTTP POST. Useful for integrating with monitoring systems, deploy pipelines, or internal tools.

```bash
curl -X POST http://localhost:8080/hooks/api/{trigger_id} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"text": "Additional context to append to the prompt"}'
```

Response:

```json
{
  "run_id": "uuid-of-new-run"
}
```

Copy the trigger URL and bearer token from the routine's trigger configuration page.

### Managing Routines

- **Run Now** — manually trigger a run immediately
- **Edit** — change prompt, model, triggers, env vars
- **Delete** — remove the routine and all its history
- **Enable/Disable** — toggle without deleting (useful for temporarily pausing)

### Run History

Every run captures:
- **Status** — pending, running, success, failed, or cancelled
- **Duration** — wall-clock time from start to finish
- **Output** — cleaned-up stdout (raw JSON stripped, only meaningful text shown)
- **Stderr** — any error messages from OpenCode
- **Metadata** — trigger context (commit SHA, PR number, alert payload, etc.)
- **Exit code** — 0 for success, non-zero for failure

Live runs stream output via SSE, so you can watch them in real time from the web UI.

### Settings

Store global environment variables (API keys, secrets) that are injected into every run. Mark sensitive values as "secret" to mask them in the UI (but they're still passed in full to OpenCode).

Example:
```
ANTHROPIC_API_KEY = sk-ant-...
GITHUB_TOKEN = ghp_...
SLACK_WEBHOOK = https://hooks.slack.com/...
```

Per-routine environment variables in the routine form override global settings.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/routines` | List / create routines |
| GET/PUT/DELETE | `/api/routines/{id}` | Manage a routine |
| POST | `/api/routines/{id}/run` | Manually trigger a run |
| GET/POST | `/api/routines/{id}/triggers` | List / add triggers |
| PUT/DELETE | `/api/triggers/{id}` | Manage a trigger |
| GET | `/api/runs` | List runs (supports `?routine_id=`, `?status=`, `?limit=`, `?offset=`) |
| GET | `/api/runs/{id}` | Run detail with full output |
| GET | `/api/runs/{id}/stream` | SSE live log stream (parsed OpenCode events) |
| POST | `/api/runs/{id}/cancel` | Cancel a running process |
| GET | `/api/models` | List available LLM models from OpenCode |
| GET/PUT/DELETE | `/api/settings` | Manage global environment variables |
| POST | `/hooks/api/{trigger_id}` | API trigger endpoint (bearer token auth) |
| POST | `/hooks/github/{trigger_id}` | GitHub webhook endpoint (HMAC-SHA256 verification) |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | — | OpenAI API key for GPT models |
| `GOOGLE_API_KEY` | — | Google AI API key |
| `OPENCODE_MODEL` | `opencode/minimax-m2.5-free` | Default model for new routines |
| `ADMIN_TOKEN` | — | Bearer token to protect the web UI (`/api/*` routes) |
| `MAX_CONCURRENT_RUNS` | `5` | Max simultaneous routine executions |
| `DATABASE_URL` | `sqlite:////data/routines.db` | SQLite database path |
| `WORKSPACES_DIR` | `/workspaces` | Directory for cloned repos and run working dirs |

### Securing the UI

Set `ADMIN_TOKEN` in `.env` to require a bearer token for all API calls:

```bash
export ADMIN_TOKEN="my-secret-token"
```

Then pass the token with all requests:

```bash
curl http://localhost:8080/api/routines \
  -H "Authorization: Bearer my-secret-token"
```

Webhook endpoints (`/hooks/*`) use their own authentication (bearer tokens for API triggers, HMAC signatures for GitHub).

## Project Structure

```
opencode-routines/
├── docker-compose.yml           # Single-container compose file
├── Dockerfile                   # Python 3.12 + Node.js + OpenCode CLI
├── requirements.txt             # Python dependencies
├── .env.example                 # Template for .env
├── .env                         # (created by you with API keys)
├── README.md                    # This file
├── backend/
│   ├── main.py                 # FastAPI app, lifespan, middleware
│   ├── config.py               # Pydantic settings from env
│   ├── database.py             # SQLite engine, session factory
│   ├── models.py               # SQLAlchemy ORM (Routine, Trigger, Run, Setting)
│   ├── schemas.py              # Pydantic request/response schemas
│   ├── routers/
│   │   ├── routines.py         # CRUD endpoints for routines
│   │   ├── triggers.py         # CRUD endpoints for triggers
│   │   ├── runs.py             # Run history, detail, cancel, SSE streaming
│   │   ├── webhooks.py         # API and GitHub webhook handlers
│   │   └── settings.py         # Global environment variable management
│   ├── services/
│   │   ├── executor.py         # Subprocess management, workspace prep, output parsing
│   │   ├── scheduler.py        # APScheduler wrapper for cron triggers
│   │   └── github.py           # GitHub HMAC verification, event parsing
│   └── static/
│       ├── index.html          # SPA shell with Tailwind CDN
│       └── app.js              # Hash router, API client, render functions
└── workspaces/                 # (docker volume) cloned repos, run working dirs
```

## How It Works

### Execution Flow

1. **Trigger fires** (cron, API call, GitHub webhook) → insert Run row with `status=pending`
2. **Background task** spawns:
   - If a git repo is configured, clone/pull it to `{workspace}/{routine_id}/repo`
   - Prepare environment dict from global settings + routine-specific overrides
   - Spawn `opencode run "{prompt}" --model {model} --format json` as subprocess
3. **Output capture**:
   - Read stdout/stderr concurrently from the subprocess
   - Parse OpenCode's JSON event stream and extract meaningful text:
     - `text` events → assistant responses (white)
     - `tool_call` events → tool invocations like file edits (cyan)
     - `tool_result` events → tool output (gray)
     - `step_finish` events → token counts and costs (dim)
     - `error` events → error messages (red)
   - Stream parsed events via SSE to connected web UI clients
   - Accumulate full output in a buffer for storage
4. **On completion**:
   - Set `status=success` (exit code 0) or `status=failed` (exit code non-zero)
   - Store stdout, stderr, exit code, and metadata to database
   - Close live stream connection

### Cron Scheduling

APScheduler loads all enabled cron triggers on startup and registers them with the scheduler. When a cron expression matches, the job callback inserts a new Run and spawns `executor.start_run()` in the background.

### GitHub Webhooks

1. GitHub sends a POST to `/hooks/github/{trigger_id}`
2. Verify HMAC-SHA256 signature using the stored webhook secret
3. Parse event type and action (e.g., `pull_request.opened`)
4. Check if it matches the trigger's configured events
5. Extract metadata (commit SHA, PR number, author, etc.) and append to prompt as context
6. Insert a new Run and start execution

### API Triggers

1. Client POSTs to `/hooks/api/{trigger_id}` with bearer token
2. Verify token against stored value
3. Optional `text` field in request body is appended to the prompt
4. Insert a new Run and start execution
5. Return the new run ID so the client can poll/watch the result

## Examples

### Daily PR Review Summary

**Trigger:** Cron (weekdays at 9am)

**Prompt:**
```
Review all open PRs in the main branch. For each PR:
1. Summarize the changes
2. Flag any potential issues (security, performance, best practices)
3. Suggest reviewers based on code ownership

Format as a markdown table for easy scanning.
```

**Model:** `opencode/minimax-m2.5-free` (cheap, fast)

**Repository:** `https://github.com/your-org/your-repo`

Result: Every weekday morning, get a fresh summary of what's in flight.

### Alert Triage Bot

**Trigger:** API (called by monitoring system)

**Prompt:**
```
Analyze the error alert below. Determine:
1. Root cause
2. Severity (critical, high, medium, low)
3. Immediate actions to take
4. Link to relevant code or docs

Alert details: {context from monitoring system}
```

**Model:** `anthropic/claude-opus-4-5` (more expensive, better reasoning)

Call from your monitoring system:

```bash
curl -X POST https://my-routines.example.com/hooks/api/{trigger_id} \
  -H "Authorization: Bearer {token}" \
  -d '{"text": "Alert: API latency spike (99th percentile: 5s, normal: 200ms) in checkout service"}'
```

Result: In seconds, get an analysis and action plan without a human on-call reading logs.

### Continuous Documentation Drift Detection

**Trigger:** Cron (weekly)

**Prompt:**
```
Scan the git history for merged PRs in the last 7 days.
For each PR that modifies core code (src/**, lib/**):
- Check if the corresponding API docs (docs/**) were updated
- If not, flag it and suggest what docs should be updated

Output as a checklist for the docs team.
```

**Model:** `opencode/minimax-m2.5-free`

**Repository:** `https://github.com/your-org/api-docs`

Result: Weekly nudge to keep documentation in sync with code.

## Limitations & Future Ideas

**Current limitations:**
- Single machine deployment (no clustering)
- SQLite only (fine for < 1M runs, consider PostgreSQL for larger scales)
- Max 5 concurrent runs by default (configurable)
- No run output versioning or diffs

**Future ideas:**
- Multiple run strategies (retry, exponential backoff, conditional triggers)
- Slack integration to post run summaries
- Filtering/sorting on runs dashboard
- Run cost analytics
- Multi-tenant support
- Email notifications
- Custom agents

## Development

### Local setup (without Docker)

```bash
# Install dependencies
pip install -r requirements.txt

# Initialize database
python -c "from backend.database import init_db; init_db()"

# Run the app
uvicorn backend.main:app --reload
```

The frontend will auto-reload on changes. Python code changes require restart.

### Adding a new router

1. Create `backend/routers/your_feature.py`
2. Define a FastAPI router and include it in `backend/main.py`
3. Use the existing routers as a template

### Testing a trigger

**Cron:** wait for the scheduled time, or manually edit the cron expression in the UI to match the next minute.

**API:** use curl (see examples above).

**GitHub:** use GitHub's webhook delivery logs in repository settings, or test locally with a tool like [ngrok](https://ngrok.com).

## License

MIT. Use freely, modify as needed, contributions welcome.

## References

- [OpenCode docs](https://opencode.ai/docs)
- [Claude Code routines](https://code.claude.com/docs/en/routines) (inspiration)
- [APScheduler docs](https://apscheduler.readthedocs.io/)
- [FastAPI docs](https://fastapi.tiangolo.com/)
