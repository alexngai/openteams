# OpenTeams CLI - Usage Guide

OpenTeams is a CLI and TypeScript library for defining multi-agent team structures. It provides YAML-based templates for declaring roles, topology, communication channels, and prompts. Agent systems consume the resolved structure and implement their own runtime behavior.

## Installation

```bash
npm install openteams
npm run build
```

## Quick Start

```bash
# Validate a template
openteams template validate ./examples/gsd

# Generate SKILL.md + agent prompt files
openteams generate all ./examples/gsd -o ./output/gsd

# Generate just the SKILL.md
openteams generate skill ./examples/gsd

# Generate a deployable package
openteams generate package ./examples/gsd -o ./output/gsd-package

# Install a template from a git repo
openteams template install owner/repo

# Launch the visual editor
openteams editor -d ./examples/gsd
```

## Commands

### Template Management

| Command | Description |
|---------|-------------|
| `openteams template validate <dir>` | Validate a template directory |
| `openteams template install <repo-url> [name]` | Install a template from git |

Options for `template install`:
- `-o, --output <path>` - Install to a specific directory
- `-y, --yes` - Skip confirmation prompts

### Generate Artifacts

| Command | Description |
|---------|-------------|
| `openteams generate skill <dir>` | Generate `SKILL.md` from a template |
| `openteams generate catalog <dir>` | Generate a lightweight role catalog |
| `openteams generate agents <dir>` | Generate one prompt file per role |
| `openteams generate all <dir>` | Generate `SKILL.md` + all agent prompts |
| `openteams generate package <dir>` | Generate a deployable skill package directory |
| `openteams generate role-package <dir> -r <role>` | Generate a standalone `SKILL.md` for one role |

Common options:
- `-n, --name <name>` - Override the team name
- `-o, --output <path>` - Output path or directory

### Visual Editor

| Command | Description |
|---------|-------------|
| `openteams editor` | Launch interactive team configuration editor |

Options:
- `-d, --dir <path>` - Template directory (default: cwd)
- `-p, --port <port>` - Port (default: 5173)

## Programmatic Usage

```typescript
import { TemplateLoader, generateSkillMd, generateAgentPrompts } from "openteams";

// Load and inspect a template
const template = TemplateLoader.load("./my-team");
console.log(template.manifest.roles);
console.log(template.manifest.topology);
console.log(template.manifest.communication);

// Generate artifacts
const skillMd = generateSkillMd(template, { teamName: "my-team" });
const prompts = generateAgentPrompts(template, { teamName: "my-team" });
```

## Template Directory Structure

```
templates/my-team/
├── team.yaml              # Manifest: topology, communication, roles
├── roles/
│   ├── planner.yaml       # Role definition with capabilities
│   └── executor.yaml
├── prompts/
│   ├── planner.md         # Single-file prompt (simple roles)
│   └── executor/          # Multi-file prompt directory
│       ├── SOUL.md        # Personality, values, communication style
│       ├── ROLE.md        # Operational instructions (primary)
│       └── RULES.md       # Constraints (optional)
└── tools/
    └── mcp-servers.json   # MCP server config per role (optional)
```

### Minimal team.yaml

```yaml
name: my-team
version: 1
roles: [coordinator, worker]
topology:
  root:
    role: coordinator
  spawn_rules:
    coordinator: [worker]
    worker: []
```

### Full team.yaml with communication

```yaml
name: self-driving
description: "Autonomous development"
version: 1
roles: [planner, grinder, judge]

topology:
  root:
    role: planner
    prompt: prompts/planner.md
    config: { model: sonnet }
  companions:
    - role: judge
      prompt: prompts/judge.md
  spawn_rules:
    planner: [grinder, planner]
    judge: []
    grinder: []

communication:
  enforcement: audit
  channels:
    task_updates:
      description: "Task lifecycle events"
      signals: [TASK_CREATED, TASK_COMPLETED, TASK_FAILED]
    work_coordination:
      signals: [WORK_ASSIGNED, WORKER_DONE]
  subscriptions:
    planner:
      - channel: task_updates
      - channel: work_coordination
        signals: [WORKER_DONE]
    judge:
      - channel: task_updates
        signals: [TASK_FAILED]
    grinder:
      - channel: work_coordination
        signals: [WORK_ASSIGNED]
  emissions:
    planner: [TASK_CREATED, WORK_ASSIGNED]
    grinder: [WORKER_DONE]
  routing:
    peers:
      - from: judge
        to: planner
        via: direct
        signals: [FIXUP_CREATED]

# Extension fields for other systems (stored, not interpreted)
macro_agent:
  task_assignment: { mode: pull }
```

### Role Inheritance

Roles support single inheritance via `extends`:

```yaml
# roles/senior.yaml
name: senior
capabilities: [code, review, deploy]

# roles/junior.yaml
name: junior
extends: senior
capabilities:
  add: [debug]
  remove: [deploy]
# Resolved: [code, review, debug]
```

## Testing

```bash
npm test              # Run tests once
npm run test:watch    # Watch mode
```
