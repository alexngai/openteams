# OpenTeams - Design Document

## Overview

OpenTeams is a TypeScript CLI tool for managing multi-agent teams. It implements the core coordination primitives from Claude Code's Agent Teams — team lifecycle, shared task lists, inter-agent messaging, and agent spawning — as a standalone CLI backed by SQLite for state management.

Agent spawning uses a swappable interface. The default implementation delegates to [acp-factory](https://github.com/sudocode-ai/acp-factory), which supports multiple AI coding agent providers (Claude Code, Codex, Copilot, Gemini, etc.) via the Agent Client Protocol (ACP).

## Architecture

```
┌─────────────────────────────────────────────┐
│                CLI Layer                     │
│  openteams team|task|message|agent <cmd>     │
└─────────────┬───────────────────────────────┘
              │
┌─────────────▼───────────────────────────────┐
│             Service Layer                    │
│  TeamService  TaskService  MessageService    │
│              AgentService                    │
└──────┬──────────────┬───────────────────────┘
       │              │
┌──────▼──────┐  ┌────▼──────────────────────┐
│  Database   │  │  AgentSpawner Interface    │
│  (SQLite)   │  │  ├─ ACPFactorySpawner     │
│             │  │  └─ (custom spawners)     │
└─────────────┘  └───────────────────────────┘
```

### Components

1. **CLI Layer** (`src/cli/`) — Command parsing via `commander`. Thin layer that delegates to services.
2. **Service Layer** (`src/services/`) — Business logic for teams, tasks, messages, and agents.
3. **Database Layer** (`src/db/`) — SQLite via `better-sqlite3`. Schema migrations, typed queries.
4. **Agent Spawner** (`src/spawner/`) — Swappable interface for agent lifecycle. Default: acp-factory.

## Data Model

### Database Schema (SQLite)

```sql
-- Teams
CREATE TABLE teams (
  name        TEXT PRIMARY KEY,
  description TEXT,
  agent_type  TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  status      TEXT DEFAULT 'active' CHECK (status IN ('active', 'deleted'))
);

-- Team members
CREATE TABLE members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name  TEXT NOT NULL REFERENCES teams(name),
  agent_name TEXT NOT NULL,
  agent_id   TEXT,
  agent_type TEXT DEFAULT 'general-purpose',
  status     TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'shutdown')),
  spawn_prompt TEXT,
  model      TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(team_name, agent_name)
);

-- Tasks
CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  subject     TEXT NOT NULL,
  description TEXT NOT NULL,
  active_form TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'deleted')),
  owner       TEXT,
  metadata    TEXT DEFAULT '{}',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Task dependency edges
CREATE TABLE task_deps (
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  blocked_by  INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, blocked_by)
);

-- Messages
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name   TEXT NOT NULL REFERENCES teams(name),
  type        TEXT NOT NULL CHECK (type IN ('message', 'broadcast', 'shutdown_request', 'shutdown_response', 'plan_approval_response')),
  sender      TEXT NOT NULL,
  recipient   TEXT,
  content     TEXT NOT NULL,
  summary     TEXT,
  request_id  TEXT,
  approve     INTEGER,
  delivered   INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

## Agent Spawner Interface

```typescript
interface SpawnOptions {
  name: string;
  teamName: string;
  prompt: string;
  agentType?: 'bash' | 'general-purpose' | 'explore' | 'plan';
  model?: 'sonnet' | 'opus' | 'haiku';
  cwd?: string;
  env?: Record<string, string>;
  permissionMode?: 'auto-approve' | 'auto-deny' | 'interactive';
}

interface AgentInstance {
  id: string;
  name: string;
  isRunning(): boolean;
  sendPrompt(prompt: string): AsyncIterable<AgentUpdate>;
  shutdown(): Promise<void>;
}

interface AgentUpdate {
  type: 'text' | 'tool_call' | 'thought' | 'error' | 'done';
  content: string;
}

interface AgentSpawner {
  spawn(options: SpawnOptions): Promise<AgentInstance>;
  shutdown(agentId: string): Promise<void>;
  list(): AgentInstance[];
}
```

### Default Implementation: ACPFactorySpawner

Uses `acp-factory` to spawn agents via the Agent Client Protocol:

```typescript
import { AgentFactory } from "acp-factory";

class ACPFactorySpawner implements AgentSpawner {
  async spawn(options: SpawnOptions): Promise<AgentInstance> {
    const agent = await AgentFactory.spawn(options.model ?? "claude-code", {
      permissionMode: options.permissionMode ?? "auto-approve",
      env: options.env,
    });
    const session = await agent.createSession(options.cwd ?? process.cwd());
    // Wrap in AgentInstance adapter
    return new ACPAgentInstance(agent, session, options);
  }
}
```

### Custom Spawners

Users can implement their own `AgentSpawner` and register it:

```typescript
import { setSpawner } from "openteams";
setSpawner(new MyCustomSpawner());
```

## CLI Commands

### Team Management

```
openteams team create <name> [--description <desc>] [--agent-type <type>]
openteams team list
openteams team info <name>
openteams team delete <name>
```

### Task Management

```
openteams task create <team> --subject <subject> --description <desc> [--active-form <text>] [--blocked-by <id,...>] [--metadata <json>]
openteams task list <team> [--status <status>] [--owner <name>]
openteams task get <team> <task-id>
openteams task update <team> <task-id> [--status <status>] [--owner <name>] [--subject <subject>] [--description <desc>] [--add-blocks <id,...>] [--add-blocked-by <id,...>] [--metadata <json>]
```

### Messaging

```
openteams message send <team> --to <recipient> --content <content> --summary <summary>
openteams message broadcast <team> --content <content> --summary <summary>
openteams message shutdown <team> --to <recipient> [--reason <reason>]
openteams message list <team> [--agent <name>]
```

### Agent Management

```
openteams agent spawn <team> --name <name> --prompt <prompt> [--type <agent-type>] [--model <model>] [--cwd <dir>]
openteams agent list <team>
openteams agent info <team> <name>
openteams agent shutdown <team> <name>
```

## Team Templates

OpenTeams supports declarative team templates — YAML-based definitions that describe team topology, roles, communication patterns, and spawn rules. Templates are designed to be interoperable with other multi-agent systems (e.g., macro-agent); generic fields are top-level, system-specific extensions live under namespaced keys.

### Template Directory Structure

```
templates/<team-name>/
├── team.yaml              # Manifest: topology, communication, roles
├── roles/                 # Role definitions (optional)
│   └── <role-name>.yaml
└── prompts/               # Static role prompt files (optional)
    └── <role-name>.md
```

### Manifest Schema (team.yaml)

```yaml
name: self-driving
description: "Autonomous codebase development"
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
  emissions:
    planner: [TASK_CREATED, WORK_ASSIGNED]
    grinder: [WORKER_DONE]
  routing:
    peers:
      - from: judge
        to: planner
        via: direct
        signals: [FIXUP_CREATED]

# Extension fields (stored, not interpreted by openteams)
macro_agent:
  task_assignment: { mode: pull }
```

### Communication Model

Three layers:

1. **Status flow** — Automatic upstream propagation (configured via `routing.status`)
2. **Signal channels** — Topic-based pub/sub with per-role subscription filtering
3. **Peer routes** — Direct role-to-role messaging (via `direct`, `topic`, or `scope`)

Signals are emitted through channels and routed to subscribers based on their subscription config. Emission permissions restrict which signals a role can emit.

### Communication Database Tables

```sql
-- Channel definitions
CREATE TABLE channels (team_name, name, description);
CREATE TABLE channel_signals (channel_id, signal);

-- Subscriptions (role → channel, optional signal filter)
CREATE TABLE subscriptions (team_name, role, channel, signal);

-- Emission permissions
CREATE TABLE emissions (team_name, role, signal);

-- Peer routing rules
CREATE TABLE peer_routes (team_name, from_role, to_role, via, signals);

-- Signal event log
CREATE TABLE signal_events (team_name, channel, signal, sender, payload, created_at);

-- Spawn rules
CREATE TABLE spawn_rules (team_name, from_role, to_role);
```

### Bootstrap Flow

```
template load <dir>
  → TemplateLoader.load(dir)         # Parse YAML, validate, resolve roles/prompts
  → TemplateService.bootstrap()
    → TeamService.create()            # Create team with template_name/template_path
    → CommunicationService.applyConfig()  # Wire channels, subs, emissions, peers
    → Store spawn rules
```

## Testing Strategy

- **Unit tests** for each service (team, task, message, agent, template, communication) using in-memory SQLite
- **Template loader tests** with temporary filesystem fixtures
- **Agent spawner tests** using a mock/stub spawner implementation
- Framework: vitest

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing |
| `better-sqlite3` | SQLite database |
| `js-yaml` | YAML template parsing |
| `acp-factory` | Default agent spawner (optional) |
| `vitest` | Testing |

## File Structure

```
src/
├── index.ts              # Public API exports
├── cli.ts                # CLI entry point (bin)
├── types.ts              # Shared type definitions
├── cli/
│   ├── team.ts           # team subcommands
│   ├── task.ts           # task subcommands
│   ├── message.ts        # message subcommands
│   ├── agent.ts          # agent subcommands
│   └── template.ts       # template subcommands
├── db/
│   └── database.ts       # Database connection and schema
├── services/
│   ├── team-service.ts   # Team CRUD + members
│   ├── task-service.ts   # Task CRUD + dependency management
│   ├── message-service.ts# Message routing and storage
│   ├── agent-service.ts  # Agent lifecycle management
│   ├── template-service.ts    # Template bootstrap + spawn rules
│   └── communication-service.ts # Channels, signals, subscriptions
├── template/
│   ├── types.ts          # Template schema types
│   └── loader.ts         # YAML parsing, validation, resolution
└── spawner/
    ├── interface.ts      # AgentSpawner interface
    ├── acp-factory.ts    # Default ACP factory spawner
    └── mock.ts           # Mock spawner for testing
```
