FROM node:24-slim

# Install system deps + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI
RUN npm install -g opencode-ai@latest && opencode --version

WORKDIR /app

# --- Backend dependencies ---
COPY backend/package.json ./
RUN npm install

# --- Build backend ---
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npx tsc && npm prune --omit=dev

RUN mkdir -p /data /workspaces

ENV DATABASE_URL=sqlite:////data/routines.db
ENV WORKSPACES_DIR=/workspaces

EXPOSE 8080

CMD ["node", "dist/index.js"]
