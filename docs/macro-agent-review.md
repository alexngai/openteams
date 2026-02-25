# Macro-Agent Review: Priorities for OpenTeams

Review of the [macro-agent](https://github.com/snarktank/macro-agent) orchestration system and how its runtime requirements inform what OpenTeams should promote from untyped extension fields into first-class schema.

**Context.** OpenTeams provides the declarative schema layer (YAML parsing, role inheritance, communication topology, prompt loading). Macro-agent builds a full orchestration runtime on top — spawning agents, routing messages, managing git worktrees, running merge queues, persisting events. Today macro-agent stuffs its configuration into the opaque `macro_agent: {}` extension namespace. The priorities below identify what should graduate into the shared schema so that *any* runtime (not just macro-agent) can interoperate.

---

## Priority 1 — Enhanced Capabilities (Map Form + Namespaced Vocabulary)

**Gap.** `capabilities` is currently `string[]` with no standard vocabulary and no way to attach configuration. Macro-agent needs to express not just *what* a role can do (`file.read`, `git.commit`) but also *how it behaves* — lifecycle type, workspace isolation, pipeline stages — each with role-specific parameters. Today all of this is stuffed into the `macro_agent: {}` extension namespace.

**Insight.** Lifecycle types, workspace isolation, and pipeline stages are all role-level properties. Rather than adding separate fields for each (`RoleDefinition.lifecycle`, `RoleDefinition.workspace`, `RoleDefinition.stages`), they can be modeled as **namespaced capabilities with optional configuration**. Macro-agent already does this — it dispatches on capability tokens like `workspace.worktree` to select lifecycle handlers.

**What to do.**

Enhance `capabilities` to accept a **map form** alongside the existing array form. The key is the capability token, the value is an optional config object (opaque to OpenTeams, interpreted by the runtime):

```typescript
// Backward-compatible: string[] still works
type Capabilities = string[] | Record<string, Record<string, unknown> | null>;
```

```yaml
# Simple form — existing templates unchanged
capabilities: [file.read, git.commit, exec]

# Map form — token → optional config
capabilities:
  file.read:
  file.write:
  git.commit:
  git.branch:
  spawn:

  # Lifecycle (was Priority 2)
  lifecycle.ephemeral:
    max_duration: 3600
    cascade_terminate: true

  # Workspace isolation (was Priority 3)
  workspace.worktree:
    branch_pattern: "worker/{role}/{agent-id}"

  # Pipeline stages (optional, advisory)
  stage.commit:
    order: 3
    emits: WORKER_DONE
  stage.merge-request:
    order: 4
    emits: MERGE_REQUEST
```

**Design principles:**

- **OpenTeams is thin.** It parses both forms, resolves inheritance (add/remove operates on the key set), and passes config through. It does *not* validate namespace-specific config — that's the runtime's job.
- **Namespaces carry semantic meaning.** `lifecycle.*` = how the role runs. `workspace.*` = where it runs. `stage.*` = what phases it moves through. `file.*`, `git.*`, `task.*` = what it can do. The namespace convention is documented but not enforced as a closed enum.
- **Config is opaque.** OpenTeams stores `{ branch_pattern: "worker/{role}/{agent-id}" }` without knowing what it means. Macro-agent (or any runtime) interprets it.

**Absorption of former priorities:**

| Former Priority | Capability Namespace | Example |
|---|---|---|
| Capabilities vocabulary | `file.*`, `git.*`, `task.*`, `spawn`, `exec` | `file.read:` (no config) |
| Lifecycle types | `lifecycle.*` | `lifecycle.ephemeral: { max_duration: 3600 }` |
| Workspace isolation | `workspace.*` | `workspace.worktree: { branch_pattern: "..." }` |
| Pipeline stages | `stage.*` | `stage.commit: { order: 3, emits: WORKER_DONE }` |

**Inheritance composition** works on the key set:

```yaml
# Parent role
capabilities:
  file.read:
  file.write:
  lifecycle.persistent:

# Child role — add/remove operates on keys
capabilities:
  add: [git.commit, workspace.worktree]
  remove: [file.write]

# Or flat form
capabilities_add: [git.commit, workspace.worktree]
capabilities_remove: [file.write]
```

When a child adds a capability that needs config, it uses the map form in `capabilities_add` (or the runtime provides defaults).

**Touches:** `src/template/types.ts` (Capabilities type, RoleDefinition), `src/template/loader.ts` (parse map form, merge during inheritance), `schema/role.schema.json`, `design.md`.

---

## Priority 2 — Spawn Rules: `max_instances`

**Gap.** OpenTeams has `spawn_rules: Record<string, string[]>` — a flat map of "who can spawn whom." This can't express "planner can spawn up to 5 workers." That's a team topology constraint — it shapes how the team scales — and belongs in the shared schema.

**What to do.**
- Extend `spawn_rules` value type from `string[]` to `SpawnRule[]`:
  ```
  SpawnRule = string | { role: string, max_instances?: number }
  ```
- Keep backward compatibility — a bare `string[]` is shorthand for unconstrained rules.

```yaml
# Current form — still valid
spawn_rules:
  planner: [worker, reviewer]

# Extended form — with instance caps
spawn_rules:
  planner:
    - { role: worker, max_instances: 8 }
    - reviewer
```

**Touches:** `src/template/types.ts` (TopologyConfig), `src/template/loader.ts` (parse both forms), `schema/team.schema.json`.

---

## Deferred

The following were evaluated and deferred — they are runtime-specific concerns or lack a second consumer to justify standardization:

- **Integration strategies** (`queue` / `trunk` / `optimistic`) — describes how the runtime merges git branches. OpenTeams doesn't touch git; this stays in `macro_agent:`.
- **Spawn scaling triggers** (`scale_on`, `idle_drain`) — what triggers scaling is runtime-specific. `max_instances` is the only constraint that's truly structural.
- **Dynamic membership** (`topology.dynamic_membership`) — reasonable idea, but no second runtime needs it yet.
- **Observability schema** (`metrics_window_s`, `stale_threshold_s`, etc.) — consumed by a single runtime. No interoperability benefit until a second runtime shares the same monitoring surface.
- **API & external protocol** — REST / WebSocket / MAP / ACP transport config. Larger question, parking for later.

---

## Summary Table

| # | Priority | Schema Impact | Complexity | Status |
|---|----------|---------------|------------|--------|
| 1 | Enhanced capabilities (map form) | `RoleDefinition.capabilities` | Medium — new parse path + inheritance | Ready |
| 2 | Spawn rules — `max_instances` | `TopologyConfig.spawn_rules` | Low — backward-compat union type | Ready |
| — | Integration, observability, scaling, API | — | — | Deferred |

## Cross-Cutting Notes

- **Backward compatibility.** All priorities are purely additive. Existing templates with `capabilities: [string, ...]` continue to work unchanged. The map form is opt-in.
- **Schema migration.** All priorities are YAML-only — no database schema changes required.
- **macro_agent namespace.** As fields graduate to first-class, they should be removed from the `macro_agent` extension. Macro-agent-specific config that doesn't generalize (e.g., `acp-factory` transport options, TinyBase store config) stays in the extension namespace. Task management (push/pull assignment, claiming, task lifecycle) stays entirely in macro-agent's runtime — OpenTeams' `TaskService` remains a simple CRUD layer.
- **Validation.** Each priority should include JSON Schema updates and test coverage for the new fields in `loader.test.ts`.
- **Deferred items** stay in `macro_agent:` extension namespace. They can be revisited when a second runtime needs them or when the design pressure becomes clearer.
