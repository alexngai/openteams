#!/bin/sh
# OpenTeams - Claude Code Web Session Setup
# This script runs automatically at the start of each ccweb session
# via the SessionStart hook in .claude/settings.json

set -e

# Only run in Claude Code Web remote environments
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

log() {
  echo "[openteams-setup] $1"
}

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

# --- 1. Install dependencies ---
if [ ! -d "node_modules" ]; then
  log "Installing dependencies..."
  npm install 2>&1 | tail -5
  log "Dependencies installed."
else
  log "Dependencies already installed, skipping npm install."
fi

# --- 2. Build the project ---
if [ ! -d "dist" ]; then
  log "Building project..."
  npm run build 2>&1 | tail -5
  log "Build complete."
else
  log "dist/ already exists, skipping build."
fi

# --- 3. Make CLI available on PATH ---
CLI_LINK="/usr/local/bin/openteams"
if [ ! -f "$CLI_LINK" ] || ! openteams --version >/dev/null 2>&1; then
  log "Creating openteams CLI symlink..."
  chmod +x "$PROJECT_DIR/dist/cjs/cli.js"
  ln -sf "$PROJECT_DIR/dist/cjs/cli.js" "$CLI_LINK" 2>/dev/null \
    || sudo ln -sf "$PROJECT_DIR/dist/cjs/cli.js" "$CLI_LINK" 2>/dev/null \
    || log "Warning: could not symlink to /usr/local/bin. Use 'node dist/cjs/cli.js' instead."
  if [ -f "$CLI_LINK" ]; then
    log "openteams CLI available at $CLI_LINK"
  fi
else
  log "openteams CLI already available."
fi

# --- 4. Quick smoke test ---
log "Running smoke test..."
if node -e "require('./dist/cjs/index.js')" 2>/dev/null; then
  log "Smoke test passed — OpenTeams is ready."
else
  log "Warning: smoke test failed. You may need to run 'npm run build' manually."
fi

log "Setup complete. Run 'openteams --help' to get started."
