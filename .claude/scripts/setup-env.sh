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

# --- 5. Bootstrap team template ---
# Detection order: repo root team.yaml > OPENTEAMS_TEMPLATE env > examples/get-shit-done
TEAM_TEMPLATE=""
if [ -f "$PROJECT_DIR/team.yaml" ]; then
  TEAM_TEMPLATE="$PROJECT_DIR"
elif [ -n "$OPENTEAMS_TEMPLATE" ] && [ -f "$OPENTEAMS_TEMPLATE/team.yaml" ]; then
  TEAM_TEMPLATE="$OPENTEAMS_TEMPLATE"
elif [ -d "$PROJECT_DIR/examples/get-shit-done" ]; then
  TEAM_TEMPLATE="$PROJECT_DIR/examples/get-shit-done"
fi

if [ -n "$TEAM_TEMPLATE" ]; then
  # Extract team name from manifest
  TEAM_NAME=$(grep '^name:' "$TEAM_TEMPLATE/team.yaml" | head -1 | sed 's/^name: *//' | tr -d '"' | tr -d "'")

  if [ -n "$TEAM_NAME" ]; then
    # Bootstrap team into database (skip if already exists)
    if ! openteams team info "$TEAM_NAME" >/dev/null 2>&1; then
      log "Bootstrapping team '$TEAM_NAME' from $TEAM_TEMPLATE..."
      if openteams template load "$TEAM_TEMPLATE" 2>&1 | tail -5; then
        log "Team '$TEAM_NAME' bootstrapped."
      else
        log "Warning: team bootstrap failed. You can run 'openteams template load $TEAM_TEMPLATE' manually."
      fi
    else
      log "Team '$TEAM_NAME' already bootstrapped."
    fi

    # Append team SKILL.md to CLAUDE.md if not already present
    SKILL_MARKER="<!-- openteams-team-context -->"
    if ! grep -q "$SKILL_MARKER" "$PROJECT_DIR/CLAUDE.md" 2>/dev/null; then
      log "Generating team context for CLAUDE.md..."
      SKILL_FILE=$(mktemp)
      if openteams generate skill "$TEAM_TEMPLATE" -o "$SKILL_FILE" 2>/dev/null && [ -s "$SKILL_FILE" ]; then
        {
          echo ""
          echo "$SKILL_MARKER"
          echo ""
          cat "$SKILL_FILE"
          echo ""
          echo "<!-- /openteams-team-context -->"
        } >> "$PROJECT_DIR/CLAUDE.md"
        rm -f "$SKILL_FILE"
        log "Team context appended to CLAUDE.md."
      else
        rm -f "$SKILL_FILE"
        log "Warning: could not generate SKILL.md. Run 'openteams generate skill $TEAM_TEMPLATE' manually."
      fi
    else
      log "Team context already in CLAUDE.md."
    fi
  else
    log "Warning: could not extract team name from $TEAM_TEMPLATE/team.yaml"
  fi
else
  log "No team template found. Place a team.yaml in the repo root or set OPENTEAMS_TEMPLATE."
fi

log "Setup complete. Run 'openteams --help' to get started."
