#!/bin/bash
# Starts docker compose + the host watcher agent together.
# Ctrl+C stops both. If either exits, the other is stopped too.

ROUTINES_URL="${ROUTINES_URL:-http://localhost:8080}"
COMPOSE_PID=""
AGENT_PID=""

cleanup() {
  trap '' INT TERM EXIT  # block re-entrant signals during cleanup
  echo ""
  echo "Stopping..."
  if [ -n "$AGENT_PID" ]; then
    pkill -TERM -P "$AGENT_PID" 2>/dev/null
    kill -TERM "$AGENT_PID" 2>/dev/null
  fi
  [ -n "$COMPOSE_PID" ] && kill -TERM "$COMPOSE_PID" 2>/dev/null
  docker compose down
  exit 0
}
trap cleanup INT TERM EXIT

# Build first — if this fails, exit before starting anything
echo "Building..."
docker compose build || exit 1

# Start compose in background
docker compose up &
COMPOSE_PID=$!

# Give the backend a moment to be ready before the agent polls it
sleep 2

# Start agent in background
ROUTINES_URL="$ROUTINES_URL" ./node_modules/.bin/tsx host-agent/agent.ts &
AGENT_PID=$!

# Monitor both processes — if either exits unexpectedly, stop everything
while true; do
  if ! kill -0 "$COMPOSE_PID" 2>/dev/null; then
    echo "Docker compose exited."
    cleanup
  fi
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "Agent exited."
    cleanup
  fi
  sleep 2
done
