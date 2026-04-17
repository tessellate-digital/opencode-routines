FROM node:22-slim

# Install system deps + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI
# Pinned to 1.3.17 — later versions (1.4.x) have copilot API bugs:
#   - sends reasoning_effort "minimal" (copilot expects low/medium/high)
#   - routes gpt-5+ models to /responses endpoint which copilot doesn't support
RUN npm install -g opencode-ai@1.3.17 && opencode --version

WORKDIR /app

# --- Backend dependencies ---
COPY package*.json ./
RUN npm ci

# --- Build backend ---
COPY tsconfig.json ./
COPY backend/src ./backend/src
RUN npx tsc && npm prune --omit=dev

RUN mkdir -p /data /workspaces

ENV DATABASE_URL=sqlite:////data/routines.db
ENV WORKSPACES_DIR=/workspaces
# opencode reads auth.json from $XDG_DATA_HOME/opencode/. Point it at /data
# so copilot OAuth tokens persist across container restarts (the /data volume).
ENV XDG_DATA_HOME=/data

EXPOSE 8080

CMD ["node", "dist/index.js"]
