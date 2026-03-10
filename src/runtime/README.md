# Runtime State Observation Layer

In-memory observation layer for tracking team member identity, status, and communication validity at runtime. Consumes MAP-aligned events but is protocol-agnostic.

## Modules

| Module | Export | Purpose |
|---|---|---|
| `types.ts` | Types only | `MemberIdentity`, `MemberStatus`, `TeamEvent`, `TeamStateSnapshot`, etc. |
| `member-registry.ts` | `MemberRegistry` | Bidirectional identity resolution (role ↔ label ↔ agentId) |
| `validation.ts` | `validateMessage()` | Stateless communication validation against template topology |
| `team-state.ts` | `TeamState` | Event-driven state machine coordinating registry + validation |

## Quick Start

```typescript
import { TemplateLoader, TeamState } from "openteams";

// 1. Load template and create state tracker
const template = TemplateLoader.load("./examples/gsd");
const team = new TeamState("gsd", template);

// 2. Register agents as they spawn
team.applyEvent({
  type: "agent_registered",
  role: "architect",
  label: "architect",
  agentId: "gsd-architect",
});

// 3. Track state changes
team.applyEvent({
  type: "agent_state_changed",
  agentId: "gsd-architect",
  status: "busy",
  executionStatus: "tool_use",
});

// 4. Listen for changes (dashboards, observability)
team.onStateChange((event) => {
  console.log(`${event.member.identity.label}: ${event.previous?.status} → ${event.member.status}`);
});

// 5. Validate communication against topology
const result = team.validateMessageByLabel("executor", "architect", "status", "progress");
// { valid: true, violations: [] }

// 6. Snapshot for serialization
const snap = team.snapshot();
JSON.stringify(snap);
```

## Event Types

Three event types aligned with MAP protocol primitives:

| Event | When | Effect |
|---|---|---|
| `agent_registered` | Agent spawns | Adds member to registry, initial status `registered` |
| `agent_state_changed` | Agent status update | Validates transition, updates member state |
| `agent_unregistered` | Agent exits | Removes member from registry |

## Status Transitions

```
registered → idle, busy, stopped, error
idle       → busy, stopped, error
busy       → idle, stopped, error
stopped    → (terminal)
error      → registered (re-register), stopped
```

Invalid transitions throw an error.

## MemberRegistry

Bidirectional lookup between three identity axes:

```typescript
const reg = team.registry;

reg.byAgentId("gsd-architect");  // → MemberIdentity
reg.byLabel("architect");         // → MemberIdentity
reg.byRole("executor");           // → MemberIdentity[] (multi-instance)
reg.all();                        // → all registered members
```

Enforces `max_instances` from template spawn rules. Rejects unknown roles.

Auto-generates labels: first instance gets the role name (`executor`), subsequent instances get `executor-2`, `executor-3`, etc.

## Communication Validation

Stateless function — takes template + message parameters, returns result:

```typescript
import { validateMessage } from "openteams";

const result = validateMessage(template, "executor", "researcher", "status", "progress");
// { valid: false, violations: [{ message: "...", severity: "error" }] }
```

Checks:
- Both roles exist in the template
- Peer route exists (explicit or implicit root ↔ companion)
- Channel emission rights (sender can emit to channel)
- Subscription rights (receiver subscribes to channel + signal)

Severity depends on enforcement mode: `strict` → `error`, `audit`/`permissive` → `warning`.

## Design Principles

- **Observation only** — does not spawn agents, send messages, or manage tasks
- **Synchronous** — no async, no I/O, no persistence
- **Protocol-agnostic** — event types align with MAP but work with any adapter
- **Template-driven** — all validation derives from the team template's topology and communication config

## Tests

```bash
npx vitest run src/runtime/member-registry.test.ts
npx vitest run src/runtime/validation.test.ts
npx vitest run src/runtime/team-state.test.ts
```
