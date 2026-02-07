# OpenTeams CLI - Usage Guide

OpenTeams is a CLI tool for coordinating multi-agent teams. It manages team lifecycle, shared task lists, inter-agent messaging, and agent spawning.

## Installation

```bash
npm install
npm run build
```

For agent spawning via ACP (optional):

```bash
npm install acp-factory
```

## Quick Start

```bash
# Create a team
openteams team create my-project --description "Building a new feature"

# Add tasks
openteams task create my-project -s "Design API" -d "Design the REST API endpoints"
openteams task create my-project -s "Implement API" -d "Build the endpoints" --blocked-by 1
openteams task create my-project -s "Write tests" -d "Add integration tests" --blocked-by 2

# Spawn agents
openteams agent spawn my-project -n researcher -p "Research existing patterns" -t explore
openteams agent spawn my-project -n implementer -p "Implement the API" -t general-purpose

# Assign tasks
openteams task update my-project 1 --owner researcher --status in_progress

# Send messages between agents
openteams message send my-project --to implementer --content "API design is ready" --summary "Design complete"

# Check progress
openteams task list my-project

# Clean up
openteams agent shutdown my-project researcher
openteams agent shutdown my-project implementer
openteams team delete my-project
```

## Commands

### Team Management

| Command | Description |
|---------|-------------|
| `openteams team create <name>` | Create a new team |
| `openteams team list` | List all active teams |
| `openteams team info <name>` | Show team details and members |
| `openteams team delete <name>` | Delete a team (members must be shut down) |

Options for `team create`:
- `-d, --description <text>` - Team description
- `-t, --agent-type <type>` - Agent type for team lead

### Task Management

| Command | Description |
|---------|-------------|
| `openteams task create <team>` | Create a new task |
| `openteams task list <team>` | List tasks (with optional filters) |
| `openteams task get <team> <id>` | Get full task details |
| `openteams task update <team> <id>` | Update a task |

Options for `task create`:
- `-s, --subject <text>` (required) - Task title
- `-d, --description <text>` (required) - Task description
- `-a, --active-form <text>` - Present continuous form (e.g., "Fixing bug")
- `--blocked-by <ids>` - Comma-separated task IDs that block this task
- `--metadata <json>` - JSON metadata

Options for `task list`:
- `--status <status>` - Filter: pending, in_progress, completed
- `--owner <name>` - Filter by assigned agent

Options for `task update`:
- `--status <status>` - pending, in_progress, completed, deleted
- `--owner <name>` - Assign to an agent
- `-s, --subject <text>` - New title
- `-d, --description <text>` - New description
- `--add-blocks <ids>` - Task IDs this task blocks
- `--add-blocked-by <ids>` - Task IDs that block this task
- `--metadata <json>` - JSON metadata to merge

### Messaging

| Command | Description |
|---------|-------------|
| `openteams message send <team>` | Send a direct message |
| `openteams message broadcast <team>` | Broadcast to all teammates |
| `openteams message shutdown <team>` | Send a shutdown request |
| `openteams message list <team>` | List messages |

Options for `message send`:
- `--to <name>` (required) - Recipient agent name
- `--content <text>` (required) - Message body
- `--summary <text>` (required) - Short summary (5-10 words)
- `--from <name>` - Sender (default: "lead")

Options for `message list`:
- `--agent <name>` - Filter messages for a specific agent

### Agent Management

| Command | Description |
|---------|-------------|
| `openteams agent spawn <team>` | Spawn a new agent |
| `openteams agent list <team>` | List agents in a team |
| `openteams agent info <team> <name>` | Show agent details |
| `openteams agent shutdown <team> <name>` | Shut down an agent |

Options for `agent spawn`:
- `-n, --name <name>` (required) - Agent name
- `-p, --prompt <text>` (required) - Instructions for the agent
- `-t, --type <type>` - Agent type: bash, general-purpose, explore, plan (default: general-purpose)
- `-m, --model <model>` - Model: sonnet, opus, haiku
- `--cwd <dir>` - Working directory

## Programmatic Usage

```typescript
import {
  createInMemoryDatabase,
  TeamService,
  TaskService,
  MessageService,
  AgentService,
  MockSpawner,
} from "openteams";

const db = createInMemoryDatabase();
const teamService = new TeamService(db);
const taskService = new TaskService(db);
const messageService = new MessageService(db);
const agentService = new AgentService(db, new MockSpawner());

// Create a team and tasks
teamService.create({ name: "my-team", description: "Example" });
taskService.create({
  teamName: "my-team",
  subject: "Research",
  description: "Explore the codebase",
});
```

## Custom Agent Spawner

Implement the `AgentSpawner` interface to use your own agent backend:

```typescript
import type { AgentSpawner, AgentInstance, SpawnAgentOptions } from "openteams";

class MySpawner implements AgentSpawner {
  async spawn(options: SpawnAgentOptions): Promise<AgentInstance> {
    // Your spawning logic
  }
  async shutdown(agentId: string): Promise<void> {
    // Your shutdown logic
  }
  list(): AgentInstance[] {
    // Return running agents
  }
}
```

### Team Templates

| Command | Description |
|---------|-------------|
| `openteams template load <dir>` | Load a template and create a team from it |
| `openteams template validate <dir>` | Validate a template without creating a team |
| `openteams template info <team>` | Show template topology for a team |
| `openteams template emit <team>` | Emit a signal on a channel |
| `openteams template events <team>` | List signal events |

Options for `template load`:
- `-n, --name <name>` - Override the team name from the manifest

Options for `template emit`:
- `-c, --channel <channel>` (required) - Channel name
- `-s, --signal <signal>` (required) - Signal name
- `--sender <sender>` (required) - Sender agent/role name
- `-p, --payload <json>` - JSON payload

Options for `template events`:
- `-c, --channel <channel>` - Filter by channel
- `-s, --signal <signal>` - Filter by signal
- `--sender <sender>` - Filter by sender
- `--role <role>` - Show events visible to a specific role (subscription-filtered)

## Quick Start with Templates

```bash
# Validate a template
openteams template validate ./templates/self-driving

# Create a team from a template
openteams template load ./templates/self-driving

# Or with a custom name
openteams template load ./templates/self-driving -n my-project

# Inspect the communication topology
openteams template info self-driving

# Emit signals through channels
openteams template emit self-driving -c task_updates -s TASK_CREATED --sender planner -p '{"taskId":1}'

# View events visible to a specific role
openteams template events self-driving --role judge

# Spawn agents with their template roles
openteams agent spawn self-driving -n planner-1 -p "You are the planner" -t general-purpose
openteams agent spawn self-driving -n grinder-1 -p "You claim and execute tasks" -t general-purpose
```

### Template Directory Structure

```
templates/self-driving/
├── team.yaml              # Manifest: topology, communication, roles
├── roles/
│   ├── planner.yaml       # Role definition with capabilities
│   ├── grinder.yaml
│   └── judge.yaml
└── prompts/
    ├── planner.md         # Static system prompt for planner
    ├── grinder.md
    └── judge.md
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

## Recommended Workflow

### Manual (no template)

1. **Create team** - `openteams team create <name>`
2. **Define tasks** - Multiple `task create` calls with dependencies
3. **Spawn agents** - `agent spawn` for each role
4. **Assign work** - `task update` to set owners
5. **Coordinate** - `message send` / `message broadcast` as needed
6. **Monitor** - `task list` and `agent list` to track progress
7. **Shut down agents** - `agent shutdown` for each agent
8. **Clean up** - `team delete`

### Template-based

1. **Load template** - `openteams template load ./templates/my-template`
2. **Inspect topology** - `openteams template info <team>`
3. **Spawn agents** per template roles - `agent spawn` with role-appropriate prompts
4. **Create tasks** - `task create` with dependencies
5. **Emit signals** - `template emit` to coordinate through channels
6. **Monitor** - `template events` to observe signal flow
7. **Clean up** - Shutdown agents, then `team delete`

## Data Storage

All state is stored in a SQLite database at `~/.openteams/openteams.db`. The database is created automatically on first use.

## Testing

```bash
npm test              # Run tests once
npm run test:watch    # Watch mode
```
