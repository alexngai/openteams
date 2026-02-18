# OpenTeams - Design Document

## Overview

OpenTeams is a TypeScript CLI tool for managing multi-agent teams. It implements the core coordination primitives from Claude Code's Agent Teams — team lifecycle, shared task lists, inter-agent messaging, and agent spawning — as a standalone CLI backed by SQLite for state management.

Agent spawning uses a swappable interface. The default implementation delegates to [acp-factory](https://github.com/sudocode-ai/acp-factory), which supports multiple AI coding agent providers (Claude Code, Codex, Copilot, Gemini, etc.) via the Agent Client Protocol (ACP).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      CLI Layer                            │
│  openteams team|task|message|agent|template|generate      │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                   Service Layer                           │
│  TeamService   TaskService   MessageService               │
│  AgentService  TemplateService  CommunicationService      │
└──────┬──────────────────┬────────────────────────────────┘
       │                  │
┌──────▼──────┐  ┌────────▼────────────────────────────────┐
│  Database   │  │  AgentSpawner Interface (DI)             │
│  (SQLite)   │  │  ├─ ACPFactorySpawner (optional)        │
│  + Schema   │  │  └─ MockSpawner (testing)               │
│  Migrations │  └─────────────────────────────────────────┘
└─────────────┘
```

### Components

1. **CLI Layer** (`src/cli/`) — Command parsing via `commander`. Thin layer that delegates to services.
2. **Service Layer** (`src/services/`) — Business logic for teams, tasks, messages, agents, templates, and communication.
3. **Database Layer** (`src/db/`) — SQLite via `better-sqlite3`. Schema versioning with transactional migrations.
4. **Template System** (`src/template/`) — YAML-based team manifests with role inheritance, capability composition, and communication topology.
5. **Generators** (`src/generators/`) — Generate SKILL.md files, agent prompts, and package artifacts from templates.
6. **Agent Spawner** (`src/spawner/`) — Swappable interface for agent lifecycle via dependency injection. Default: acp-factory (optional).

## Data Model

### Database Schema (SQLite)

```sql
-- Teams (with enforcement mode and template metadata)
CREATE TABLE teams (
  name          TEXT PRIMARY KEY,
  description   TEXT,
  agent_type    TEXT,
  template_name TEXT,
  template_path TEXT,
  enforcement   TEXT DEFAULT 'permissive' CHECK (enforcement IN ('strict', 'permissive', 'audit')),
  created_at    TEXT DEFAULT (datetime('now')),
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'deleted'))
);

-- Team members (with role binding)
CREATE TABLE members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name  TEXT NOT NULL REFERENCES teams(name),
  agent_name TEXT NOT NULL,
  agent_id   TEXT,
  agent_type TEXT DEFAULT 'general-purpose',
  role       TEXT,
  status     TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'shutdown')),
  spawn_prompt TEXT,
  model      TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(team_name, agent_name)
);

-- Tasks (with cycle-checked dependencies)
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

-- Task dependency edges (cycle detection enforced at service layer)
CREATE TABLE task_deps (
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  blocked_by  INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, blocked_by)
);

-- Messages (with delivery tracking)
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

-- Schema versioning for migrations
CREATE TABLE schema_version (version INTEGER NOT NULL);
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

Users implement `AgentSpawner` and pass it via dependency injection:

```typescript
import { AgentService } from "openteams";
const agentService = new AgentService(db, myCustomSpawner);
```

The global `setSpawner()`/`getSpawner()` API is deprecated in favor of DI.

## CLI Commands

### Team Management

```
openteams team create <name> [--description <desc>] [--agent-type <type>]
openteams team list
openteams team info <name>
openteams team add-member <team> <name> [--role <role>] [--type <type>] [--model <model>]
openteams team delete <name>
```

### Task Management

```
openteams task create <team> -s <subject> -d <desc> [-a <active-form>] [--blocked-by <ids>] [--metadata <json>]
openteams task list <team> [--status <status>] [--owner <name>] [--json]
openteams task get <team> <task-id> [--json]
openteams task update <team> <task-id> [--status <status>] [--owner <name>] [-s <subject>] [-d <desc>] [--add-blocks <ids>] [--add-blocked-by <ids>] [--metadata <json>]
```

### Messaging

```
openteams message send <team> --to <recipient> --content <content> --summary <summary> [--from <sender>]
openteams message broadcast <team> --content <content> --summary <summary> [--from <sender>]
openteams message shutdown <team> --to <recipient> [--reason <reason>] [--from <sender>]
openteams message shutdown-response <team> --request-id <id> --approve|--reject [--content <text>] [--from <sender>]
openteams message plan-response <team> --to <recipient> --request-id <id> --approve|--reject [--content <text>] [--from <sender>]
openteams message list <team> [--agent <name>] [--json]
openteams message poll <team> --agent <name> [--mark-delivered] [--json]
openteams message ack <team> <message-id>
```

### Agent Management

```
openteams agent spawn <team> -n <name> -p <prompt> [-t <agent-type>] [-m <model>] [--cwd <dir>]
openteams agent list <team> [--json]
openteams agent info <team> <name> [--json]
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
    ├── <role-name>.md     # Single-file prompt (simple roles)
    └── <role-name>/       # Multi-file prompt directory
        ├── SOUL.md        # Personality, values, communication style
        ├── ROLE.md        # Operational instructions (primary)
        └── RULES.md       # Coding standards, constraints (optional)
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

**Enforcement modes** (set in `communication.enforcement`):
- `strict` — Unauthorized emissions throw errors
- `audit` — Unauthorized emissions are allowed but flagged as `permitted: false`
- `permissive` (default) — All emissions are allowed

### Role Inheritance

Roles support single-inheritance via `extends`:

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
# Result: [code, review, debug]
```

Multi-level chains (A extends B extends C) are resolved in topological order. Circular inheritance is detected and rejected at template load time.

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

-- Team groups (multi-team containers)
CREATE TABLE team_groups (name PRIMARY KEY, description, created_at, status);

-- Teams can belong to a group
-- (teams.group_name references team_groups)

-- Cross-team signal bridges
CREATE TABLE team_bridges (group_name, source_team, target_team, source_channel, target_channel, signals, mode);
```

### Multi-Team Groups

Teams can be organized into **groups** that enable multiple concurrent team structures operating across shared agents. This supports:

- **Multiple concurrent hierarchies** (e.g., a waterfall backend team + independent frontend team)
- **Cross-team communication** via signal bridges
- **Shared agents** that participate in multiple teams with different roles

#### Group Manifest (group.yaml)

```yaml
name: full-stack-org
description: "Backend and frontend teams with shared tech lead"
version: 1

teams:
  - name: backend-team
    template: ./backend       # References a team.yaml directory
  - name: frontend-team
    template: ./frontend

shared_agents:
  - agent: tech-lead
    memberships:
      - team: backend-team
        role: architect
      - team: frontend-team
        role: reviewer

bridges:
  - from:
      team: backend-team
      channel: api_events
      signals: [API_READY, API_BREAKING_CHANGE]
    to:
      team: frontend-team
      channel: dependency_updates
    mode: forward                   # forward | bidirectional
```

#### Bridge Semantics

- **forward**: Signals flow source → target only
- **bidirectional**: Signals flow both directions
- Bridged signals appear in the target team's event log with sender prefixed as `bridge:<source_team>:<original_sender>`
- Bridge signal filtering: if `signals` is specified, only those signals are forwarded; empty means all signals

#### Group Bootstrap Flow

```
group load <dir>
  → GroupLoader.load(dir)               # Parse group.yaml, load team templates
  → GroupBootstrapService.bootstrap()
    → TeamGroupService.create()         # Create group
    → For each team:
      → TemplateService.bootstrap()     # Bootstrap individual team
      → TeamGroupService.addTeam()      # Add to group
    → Register shared agents            # Add to multiple teams
    → TeamGroupService.addBridge()      # Wire cross-team bridges
```

### Bootstrap Flow

```
template load <dir>
  → TemplateLoader.load(dir)              # Parse YAML, validate, resolve roles/prompts
    → resolveInheritance()                # Resolve extends chains, merge capabilities
  → TemplateService.bootstrap()
    → TeamService.create()                # Create team with template_name/template_path
    → Register root + companions as members  # Auto-populate initial members
    → CommunicationService.applyConfig()  # Wire channels, subs, emissions, peers, enforcement
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
│   ├── team.ts           # team subcommands (create, list, info, add-member, delete)
│   ├── task.ts           # task subcommands (create, list, get, update) [--json]
│   ├── message.ts        # message subcommands (send, broadcast, shutdown, shutdown-response, plan-response, list, poll, ack) [--json]
│   ├── agent.ts          # agent subcommands (spawn, list, info, shutdown) [--json]
│   ├── template.ts       # template subcommands (load, info, emit, events)
│   └── group.ts          # group subcommands (create, list, info, add-team, remove-team, add-bridge, remove-bridge, load, delete)
├── db/
│   └── database.ts       # Database connection, schema, and migration framework
├── services/
│   ├── team-service.ts           # Team CRUD + member management
│   ├── task-service.ts           # Task CRUD + dependency management + cycle detection
│   ├── message-service.ts        # Message routing, delivery tracking, member validation
│   ├── agent-service.ts          # Agent lifecycle management
│   ├── template-service.ts       # Template bootstrap + spawn rules + member auto-registration
│   ├── communication-service.ts  # Channels, signals, subscriptions, enforcement
│   ├── team-group-service.ts     # Group CRUD, team membership, bridge management
│   └── group-bootstrap-service.ts # Multi-team group bootstrap from group manifests
├── template/
│   ├── types.ts          # Template schema types (manifest, roles, communication, signals, groups)
│   ├── loader.ts         # YAML parsing, validation, role inheritance resolution
│   └── group-loader.ts   # Group manifest parsing and team template resolution
├── generators/
│   ├── skill-generator.ts        # SKILL.md and catalog generation
│   ├── agent-prompt-generator.ts # Agent prompt and role skill generation
│   └── package-generator.ts      # Package artifact generation
└── spawner/
    ├── interface.ts      # Global spawner registry (deprecated, use DI)
    ├── acp-factory.ts    # ACP factory spawner (optional dependency)
    └── mock.ts           # Mock spawner for testing
```
