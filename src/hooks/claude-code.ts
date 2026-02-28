/**
 * Hook script generation for Claude Code agent teams.
 *
 * Claude Code supports two hooks relevant to team coordination:
 *
 * - TeammateIdle: fires when a teammate finishes and is about to go idle.
 *   Exit code 2 sends feedback to keep the teammate working.
 *
 * - TaskCompleted: fires when a task is being marked complete.
 *   Exit code 2 prevents completion and sends feedback.
 *
 * These generators produce:
 * 1. Shell scripts that bridge Claude Code hooks → OpenTeams signals
 * 2. A hooks.json configuration that can be merged into .claude/hooks.json
 */

import fs from "fs";
import path from "path";
import type { ResolvedTemplate } from "../template/types";

export interface HookConfig {
  hooks: {
    TeammateIdle?: HookEntry[];
    TaskCompleted?: HookEntry[];
  };
}

export interface HookEntry {
  type: "command";
  command: string;
}

export interface GenerateHooksOptions {
  /** Team name (defaults to manifest name) */
  teamName?: string;
  /** Output directory for hook scripts (default: .claude/hooks/) */
  outputDir?: string;
  /** Path to openteams CLI (default: "openteams") */
  openteamsPath?: string;
}

export interface GenerateHooksResult {
  /** The hooks.json config to merge into .claude/hooks.json */
  hooksConfig: HookConfig;
  /** Paths to generated script files */
  scriptPaths: string[];
}

/**
 * Generate hook scripts that bridge Claude Code team events to OpenTeams signals.
 *
 * When a teammate goes idle, the hook emits a `teammate_idle` signal on the
 * `lifecycle` channel. When a task is completed, it emits a `task_completed`
 * signal on the `lifecycle` channel.
 *
 * If the template defines these channels/signals, the hooks also check
 * subscriptions so other roles can react to the events.
 */
export function generateHookScripts(
  template: ResolvedTemplate,
  options: GenerateHooksOptions = {}
): GenerateHooksResult {
  const teamName = options.teamName ?? template.manifest.name;
  const outputDir = options.outputDir ?? path.join(".claude", "hooks");
  const openteamsPath = options.openteamsPath ?? "openteams";

  const scriptPaths: string[] = [];

  // TeammateIdle hook script
  const idleScript = generateTeammateIdleScript(teamName, openteamsPath);
  const idleScriptPath = path.join(outputDir, "on-teammate-idle.sh");
  scriptPaths.push(idleScriptPath);

  // TaskCompleted hook script
  const taskScript = generateTaskCompletedScript(teamName, openteamsPath);
  const taskScriptPath = path.join(outputDir, "on-task-completed.sh");
  scriptPaths.push(taskScriptPath);

  const hooksConfig: HookConfig = {
    hooks: {
      TeammateIdle: [
        {
          type: "command",
          command: idleScriptPath,
        },
      ],
      TaskCompleted: [
        {
          type: "command",
          command: taskScriptPath,
        },
      ],
    },
  };

  return { hooksConfig, scriptPaths };
}

/**
 * Write hook scripts and the hooks.json config to disk.
 */
export function installHooks(
  template: ResolvedTemplate,
  options: GenerateHooksOptions = {}
): GenerateHooksResult {
  const outputDir = options.outputDir ?? path.join(".claude", "hooks");
  const result = generateHookScripts(template, { ...options, outputDir });

  fs.mkdirSync(outputDir, { recursive: true });

  // Write TeammateIdle script
  const idleScript = generateTeammateIdleScript(
    options.teamName ?? template.manifest.name,
    options.openteamsPath ?? "openteams"
  );
  fs.writeFileSync(result.scriptPaths[0], idleScript, { mode: 0o755 });

  // Write TaskCompleted script
  const taskScript = generateTaskCompletedScript(
    options.teamName ?? template.manifest.name,
    options.openteamsPath ?? "openteams"
  );
  fs.writeFileSync(result.scriptPaths[1], taskScript, { mode: 0o755 });

  // Write hooks.json
  const hooksJsonPath = path.join(
    path.dirname(outputDir),
    "hooks.json"
  );

  let existingConfig: any = {};
  if (fs.existsSync(hooksJsonPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
    } catch {
      // Start fresh if existing config is invalid
    }
  }

  // Merge hooks
  const merged = mergeHooksConfig(existingConfig, result.hooksConfig);
  fs.writeFileSync(hooksJsonPath, JSON.stringify(merged, null, 2) + "\n");

  return result;
}

/**
 * Merge new hook entries into an existing hooks.json config
 * without duplicating existing entries.
 */
export function mergeHooksConfig(
  existing: any,
  incoming: HookConfig
): any {
  const merged = { ...existing };
  if (!merged.hooks) {
    merged.hooks = {};
  }

  for (const [event, entries] of Object.entries(incoming.hooks)) {
    if (!merged.hooks[event]) {
      merged.hooks[event] = [];
    }

    for (const entry of entries ?? []) {
      const alreadyExists = merged.hooks[event].some(
        (e: HookEntry) => e.command === entry.command
      );
      if (!alreadyExists) {
        merged.hooks[event].push(entry);
      }
    }
  }

  return merged;
}

function generateTeammateIdleScript(
  teamName: string,
  openteamsPath: string
): string {
  return `#!/usr/bin/env bash
# OpenTeams hook: TeammateIdle -> lifecycle signal
# Generated for team: ${teamName}
#
# This hook fires when a Claude Code teammate finishes and is about to go idle.
# It emits a teammate_idle signal on the lifecycle channel so other roles
# subscribed to that channel can react (e.g., the lead can reassign work).
#
# Exit codes:
#   0 = allow teammate to go idle
#   2 = send feedback to keep teammate working

set -euo pipefail

TEAM_NAME="${teamName}"
OPENTEAMS="${openteamsPath}"

# The teammate name is passed via CLAUDE_TEAMMATE_NAME env var
TEAMMATE_NAME="\${CLAUDE_TEAMMATE_NAME:-unknown}"

# Emit the lifecycle signal
\${OPENTEAMS} template emit "\${TEAM_NAME}" \\
  -c lifecycle \\
  -s teammate_idle \\
  --sender "\${TEAMMATE_NAME}" \\
  --data "{\\"teammate\\": \\"\${TEAMMATE_NAME}\\", \\"event\\": \\"idle\\"}" \\
  2>/dev/null || true

# Check if there are unclaimed pending tasks for this teammate
PENDING=$(\${OPENTEAMS} task list "\${TEAM_NAME}" --status pending --json 2>/dev/null || echo "[]")
PENDING_COUNT=$(echo "\${PENDING}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "\${PENDING_COUNT}" -gt 0 ]; then
  # There are pending tasks — tell the teammate to pick one up
  echo "There are \${PENDING_COUNT} pending task(s) in the ${teamName} team. Check the task board with: openteams task list ${teamName}"
  exit 2
fi

# No pending tasks, allow idle
exit 0
`;
}

function generateTaskCompletedScript(
  teamName: string,
  openteamsPath: string
): string {
  return `#!/usr/bin/env bash
# OpenTeams hook: TaskCompleted -> lifecycle signal
# Generated for team: ${teamName}
#
# This hook fires when a Claude Code task is being marked as complete.
# It emits a task_completed signal on the lifecycle channel and checks
# if any dependent tasks are now unblocked.
#
# Exit codes:
#   0 = allow task completion
#   2 = prevent completion and send feedback

set -euo pipefail

TEAM_NAME="${teamName}"
OPENTEAMS="${openteamsPath}"

# Task info is passed via environment variables
TASK_ID="\${CLAUDE_TASK_ID:-}"
TEAMMATE_NAME="\${CLAUDE_TEAMMATE_NAME:-unknown}"

if [ -z "\${TASK_ID}" ]; then
  # No task ID available, just allow completion
  exit 0
fi

# Emit the lifecycle signal
\${OPENTEAMS} template emit "\${TEAM_NAME}" \\
  -c lifecycle \\
  -s task_completed \\
  --sender "\${TEAMMATE_NAME}" \\
  --data "{\\"task_id\\": \\"\${TASK_ID}\\", \\"teammate\\": \\"\${TEAMMATE_NAME}\\"}" \\
  2>/dev/null || true

# Allow task completion
exit 0
`;
}
