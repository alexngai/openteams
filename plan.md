# Plan: Runtime State Observation Layer

## Goal
Add `src/runtime/` module to OpenTeams that provides:
- **Member identity registry** — bidirectional resolution between roles, labels, and runtime-specific agent identifiers (e.g., Claude Code session IDs)
- **Member state tracking** — status transitions with validation (MemberStatus + optional ExecutionStatus)
- **Topology validation** — stateless validation of communication against the template's CommunicationConfig
- **Event-driven updates** — `applyEvent()` accepts MAP-aligned events, `onStateChange()` emits for external consumers
- **Snapshots** — serializable team state for dashboards/observability

## Out of Scope
- Message storage/logging (external messaging systems handle this)
- Task management (opentasks handles this)
- Agent spawning/orchestration (runtime handles this)
- Adapter implementations for opentasks, MAP, etc. (just interfaces/types)

## Files to Create

### 1. `src/runtime/types.ts` — All runtime types

Types:
- `AgentIdentifier` — opaque string (session id, MAP agent id, etc.)
- `MemberIdentity` — { role, label, agentId }
- `MemberStatus` — "registered" | "running" | "idle" | "busy" | "stopped" | "error"
- `ExecutionStatus` — "spawning" | "prompting" | "tool_use" | "waiting" | "completed" | "cancelled" | "errored" (optional, finer-grained)
- `MemberState` — { identity, status, executionStatus?, lastActivity, error?, metadata? }
- `TeamEvent` — discriminated union aligned with MAP primitives:
  - `agent_registered` — role, label, agentId, metadata?
  - `agent_unregistered` — agentId, reason?
  - `agent_state_changed` — agentId, state (MemberStatus), executionStatus?, metadata?
- `StateChangeEvent` — what `onStateChange` emits (same shape as TeamEvent but with `previous` state)
- `TeamStateSnapshot` — serializable snapshot of all members + topology summary
- `ValidationResult` / `Violation` — for topology validation

### 2. `src/runtime/member-registry.ts` — Bidirectional identity resolution

Class `MemberRegistry`:
- `register(role, label, agentId)` → MemberIdentity
- `unregister(agentId)` → void
- `byAgentId(agentId)` → MemberIdentity | undefined
- `byLabel(label)` → MemberIdentity | undefined
- `byRole(role)` → MemberIdentity[] (multiple instances possible per spawn rules)
- `all()` → MemberIdentity[]
- `has(agentId)` → boolean

Validates against template topology — only roles that exist in the template can be registered. Handles multi-instance roles (e.g., researcher-1, researcher-2) based on spawn_rules max_instances.

### 3. `src/runtime/validation.ts` — Topology-aware communication validation

Function `validateMessage(template, fromRole, toRole, channel?, signal?)` → ValidationResult

Checks:
- Both roles exist in the template
- Peer route exists (from → to) in routing.peers, OR both are in topology (root/companions)
- If channel specified: sender has emission rights, receiver has subscription
- If signal specified: signal exists in channel definition
- Enforcement mode determines severity (strict → error, audit → warning, permissive → warning)

Stateless — takes template, returns result. No side effects.

### 4. `src/runtime/team-state.ts` — Core state tracker

Class `TeamState`:
- Constructor: `new TeamState(teamName, template)`
- `registry` property — MemberRegistry instance
- `applyEvent(event: TeamEvent)` — processes event, updates state, emits change
- `getMember(label)` → MemberState | undefined
- `getMembers()` → MemberState[]
- `validateMessage(fromLabel, toLabel, channel?)` → ValidationResult (resolves labels to roles, delegates to validation.ts)
- `onStateChange(listener)` → unsubscribe function
- `snapshot()` → TeamStateSnapshot (serializable)

Status transition validation:
- registered → running, stopped, error
- running → idle, busy, stopped, error
- idle → running, busy, stopped, error
- busy → running, idle, stopped, error
- stopped → (terminal, but allow re-register)
- error → registered (re-register), stopped

### 5. `src/runtime/index.ts` — Re-exports

Export all public types and classes.

### 6. Update `src/index.ts` — Add runtime exports

Add runtime re-exports so consumers can `import { TeamState } from "openteams"` or `import { TeamState } from "openteams/runtime"`.

## Tests

### 7. `src/runtime/member-registry.test.ts`
- Register/unregister members
- Lookup by agentId, label, role
- Multi-instance roles
- Reject unknown roles (not in template)

### 8. `src/runtime/validation.test.ts`
- Valid peer routes pass
- Missing peer routes fail
- Channel emission/subscription checks
- Signal filtering
- Enforcement modes affect severity

### 9. `src/runtime/team-state.test.ts`
- Apply agent_registered → member appears
- Apply agent_state_changed → status updates
- Apply agent_unregistered → member removed
- Invalid transitions rejected
- onStateChange fires correctly
- snapshot() returns serializable state
- validateMessage delegates correctly

## Implementation Order
1. types.ts (no dependencies)
2. member-registry.ts + test
3. validation.ts + test
4. team-state.ts + test (depends on registry + validation)
5. runtime/index.ts + update src/index.ts
6. Run all tests, build
