# Macro-Agent Review: Priorities for OpenTeams

Review of the [macro-agent](https://github.com/snarktank/macro-agent) orchestration system and how its runtime requirements inform what OpenTeams should promote from untyped extension fields into first-class schema.

**Context.** OpenTeams provides the declarative schema layer (YAML parsing, role inheritance, communication topology, prompt loading). Macro-agent builds a full orchestration runtime on top — spawning agents, routing messages, managing git worktrees, running merge queues, persisting events. Today macro-agent stuffs its configuration into the opaque `macro_agent: {}` extension namespace. The priorities below identify what should graduate into the shared schema so that *any* runtime (not just macro-agent) can interoperate.

---

## Priority 1 — Role Capabilities Vocabulary

**Gap.** `capabilities` is currently `string[]` with no standard vocabulary. Macro-agent defines a rich set: `file.read`, `file.write`, `git.commit`, `git.branch`, `task.create`, `task.assign`, `task.claim`, `exec`, `spawn`, `broadcast`, `ai.planning`. Runtimes need a shared language for what a role is allowed to do.

**What to do.**
- Define a base vocabulary of well-known capability tokens (file ops, git ops, task ops, communication, spawn).
- Add optional `CapabilityDescriptor` type with metadata (scope, constraints) alongside the simple string form.
- Keep `string[]` as the wire format — the vocabulary is advisory, not a closed enum.
- Document the vocabulary in the role JSON Schema and in `design.md`.

**Touches:** `src/template/types.ts` (RoleDefinition), `schema/role.schema.json`, `design.md`.

---

## Priority 2 — Lifecycle Types

**Gap.** Agent lifecycle is completely absent from the OpenTeams schema. Macro-agent defines four lifecycle types — `ephemeral` (task-bound, auto-terminate), `persistent` (long-running coordinator), `daemon` (background service), `event-driven` (activate on signal) — with config for cascade termination, continuations, scaling bounds. Currently this all lives in `macro_agent.lifecycle`.

**What to do.**
- Add `lifecycle` to `RoleDefinition` with a discriminated union type: `{ type: "ephemeral" | "persistent" | "daemon" | "event-driven" }`.
- Include common fields: `cascade_terminate`, `max_duration`, `continuation` (checkpoint/resume config).
- Scaling config (`min_workers`, `max_workers`, `scale_on`) can stay in extension namespace for now — it's runtime-specific.

**Touches:** `src/template/types.ts` (RoleDefinition), `schema/role.schema.json`.

---

## Priority 3 — Task Management Protocol

**Gap.** OpenTeams has a `TaskService` for CRUD and dependency tracking but no concept of push vs. pull assignment, claiming, or task lifecycle states beyond status strings. Macro-agent has a full pluggable task backend with `create`, `assign`, `claim`, `unclaim`, and two modes (push = coordinator assigns, pull = workers claim from pool).

**What to do.**
- Add `task_assignment` to the team manifest communication config: `{ mode: "push" | "pull" }` with optional pull-mode config (`idle_timeout_s`, `claim_retry_delay_ms`, `max_concurrent_per_agent`).
- Add `claim` / `unclaim` operations to `TaskService` (atomic status transitions).
- Define standard task lifecycle states: `pending → claimed → in_progress → completed | failed | abandoned`.
- Keep the backend-agnostic interface so runtimes can swap implementations.

**Touches:** `src/template/types.ts` (CommunicationConfig or new TaskConfig), `src/services/task-service.ts`, `src/types.ts` (Task type), `schema/team.schema.json`.

---

## Priority 4 — Workspace Isolation Schema

**Gap.** Macro-agent manages a git worktree pool with per-role branch naming patterns (`worker/{prefix}/{agent-id}/{task-id}@{timestamp}`), isolation rules (own worktree vs. shared), and integration branch concepts. None of this is representable in the OpenTeams schema today.

**What to do.**
- Add `workspace` to `RoleDefinition`: `{ type: "own" | "shared" | "none", branch_pattern?: string }`.
- Add `integration_branch` to `TopologyConfig` (the target branch for merges).
- These are declarative — the schema describes *intent*, the runtime implements actual worktree management.

**Touches:** `src/template/types.ts` (RoleDefinition, TopologyConfig), `schema/role.schema.json`, `schema/team.schema.json`.

---

## Priority 5 — Integration Strategies

**Gap.** Macro-agent implements three merge/integration strategies — `queue` (serialized, safe), `trunk` (direct rebase-push), `optimistic` (push + async validation) — each with config for retry limits and conflict resolution. OpenTeams has no concept of how work gets merged back.

**What to do.**
- Add `integration` to the team manifest: `{ strategy: "queue" | "trunk" | "optimistic", config?: { max_retries?: number, conflict_action?: "abandon" | "rebase" | "escalate" } }`.
- This is purely declarative schema — execution is the runtime's job.
- Document the strategy semantics so multiple runtimes implement them consistently.

**Touches:** `src/template/types.ts` (TeamManifest or new IntegrationConfig), `schema/team.schema.json`.

---

## Priority 6 — Pipeline Stages

**Gap.** Macro-agent's worker lifecycle follows a clear pipeline: `spawn → initialize → work → commit → merge-request → [merge/conflict] → done`. The coordinator has a parallel pipeline: `plan → spawn-workers → monitor → synthesize → done`. These stage transitions drive signal emission (WORKER_DONE, MERGE_REQUEST, MERGE_COMPLETE) and lifecycle handlers. OpenTeams doesn't model execution stages at all.

**What to do.**
- Add optional `stages` to `RoleDefinition`: an ordered list of named stages that a role moves through.
- Define a base set of well-known stage names: `init`, `work`, `review`, `merge`, `done`, `failed`.
- Map stages to signal emissions — when a role enters a stage, it can auto-emit the corresponding signal.
- This gives runtimes a shared vocabulary for progress tracking without prescribing execution details.

**Touches:** `src/template/types.ts` (RoleDefinition), `schema/role.schema.json`.

---

## Priority 7 — Spawn Rules Enrichment

**Gap.** OpenTeams has `spawn_rules: Record<string, string[]>` — a flat map of "who can spawn whom." Macro-agent extends this with constraints: max concurrent instances, scaling triggers (`task_queue_depth`), idle drain policies, and dynamic child registration (agents spawned at runtime auto-join the team). The current schema can't express "planner can spawn up to 5 grinders, scaled by queue depth."

**What to do.**
- Extend `spawn_rules` value type from `string[]` to `SpawnRule[]`:
  ```
  SpawnRule = string | { role: string, max_instances?: number, scale_on?: string }
  ```
- Keep backward compatibility — a bare `string[]` is shorthand for unconstrained rules.
- Dynamic registration (auto-join) is a runtime behavior, but the schema should declare whether a team allows it: `topology.dynamic_membership: boolean`.

**Touches:** `src/template/types.ts` (TopologyConfig), `src/template/loader.ts` (parse both forms), `schema/team.schema.json`.

---

## Priority 8 — Observability Schema

**Gap.** Macro-agent defines per-team observability config: `metrics_window_s`, `snapshot_interval_s`, health check timers, stale agent detection thresholds. Currently all in `macro_agent.observability`. As teams grow, any runtime needs to know what to measure and when to alert.

**What to do.**
- Add optional `observability` to the team manifest:
  ```
  observability?: {
    metrics_window_s?: number;
    snapshot_interval_s?: number;
    stale_threshold_s?: number;
    health_check_interval_s?: number;
  }
  ```
- Keep it minimal — these are hints to the runtime, not a full monitoring spec.
- The runtime decides *how* to collect and expose metrics; the schema says *what* to watch.

**Touches:** `src/template/types.ts` (TeamManifest), `schema/team.schema.json`.

---

## Priority 9 — API & External Protocol (Deferred)

Macro-agent exposes REST + WebSocket + MAP protocol + ACP stdio. Whether OpenTeams should define a standard external API shape is a larger question. Parking this for later.

---

## Summary Table

| # | Priority | Schema Impact | Complexity |
|---|----------|---------------|------------|
| 1 | Role capabilities vocabulary | `RoleDefinition.capabilities` | Low — vocabulary + docs |
| 2 | Lifecycle types | `RoleDefinition.lifecycle` | Medium — new type union |
| 3 | Task management protocol | `TaskService` + manifest config | High — new service ops |
| 4 | Workspace isolation | `RoleDefinition.workspace` | Low — declarative only |
| 5 | Integration strategies | `TeamManifest.integration` | Low — declarative only |
| 6 | Pipeline stages | `RoleDefinition.stages` | Medium — stages + signal mapping |
| 7 | Spawn rules enrichment | `TopologyConfig.spawn_rules` | Medium — backward-compat parsing |
| 8 | Observability schema | `TeamManifest.observability` | Low — optional config block |
| 9 | API & external protocol | TBD | — deferred |

## Cross-Cutting Notes

- **Backward compatibility.** Priorities 1, 4, 5, 7, 8 are purely additive — new optional fields, no breaking changes. Priorities 2, 3, 6 introduce new type structures but existing templates remain valid.
- **Schema migration.** Database schema changes are needed only for Priority 3 (task claiming adds columns to the `tasks` table). The rest are YAML-only.
- **macro_agent namespace.** As fields graduate to first-class, they should be removed from the `macro_agent` extension. Macro-agent-specific config that doesn't generalize (e.g., `acp-factory` transport options, TinyBase store config) stays in the extension namespace.
- **Validation.** Each priority should include JSON Schema updates and test coverage for the new fields in `loader.test.ts`.
