FROM node:22-slim

# Install system deps + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI
RUN npm install -g opencode-ai@latest && opencode --version

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

EXPOSE 8080

CMD ["node", "dist/index.js"]
