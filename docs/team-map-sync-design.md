# Teams as MAP-Syncable Resources — Design Exploration

> Status: **Exploration** — not a spec, not committed to. This document sketches what it could look like to publish OpenTeams team templates and loadouts as first-class, syncable resources over MAP, with **cross-runtime agent dispatch** as the centering use case.

## The Centering Use Case

An orchestrator running on machine A (Claude Code) decides it needs an `executor`. The pool worker that picks up the spawn is on machine B (could be Gemini, Codex, or a custom runtime). For that worker to actually boot a meaningful agent, it needs:

- The **team definition** (so member events line up — channels, signals, topology)
- The role's **loadout** (capabilities, permissions, MCP scope, prompt addendum)
- A **stable identifier** for both, so the orchestrator can refer to "the executor loadout *I* resolved" rather than rehydrating the entire team on the dispatch path

Today none of this travels over the wire. Templates live on disk in the agent system that loaded them. The runtime layer (`src/runtime/`) already emits MAP-aligned member events (`agent_registered`, `agent_state_changed`, `agent_unregistered`), but those events reference roles by name only — they're meaningful only against a team manifest the receiver already has.

Publishing the manifest itself, as a content-addressed resource, closes the loop: orchestrators dispatch by hash, workers fetch what they don't have, member events validate against the exact bundle the publisher used.

## The Problem, Spelled Out

1. **No shared vocabulary.** When Agent A says "I am `executor-2`," Agent B has no protocol-level way to know what role `executor` is, what channels it subscribes to, or what loadout it carries.
2. **No dispatch semantics.** An orchestrator that wants to spawn a child on a different machine has no portable way to say "with *this* loadout."
3. **No discovery.** A federation bridge or a UI dashboard must obtain templates through side channels (git clone, scp, manual install).

## Design Principles

1. **Definition stays definitional.** Synced artifacts are *resolved, immutable snapshots* — not live editable state. Edits happen in files via the CLI, then a new snapshot is published.
2. **Content-addressed.** Resources are identified by hash. Names and versions are aliases that point at hashes.
3. **Loadouts are first-class.** A loadout has its own bundle, its own URI, its own lifecycle. A team is a *composition* of loadouts (plus topology and communication).
4. **Reuse MAP primitives — don't invent verbs.** Bundles map onto MAP `context`. Spawn dispatch maps onto MAP `task`. Member events already align with MAP. OpenTeams ships zero new protocol — only typed payloads on existing primitives.
5. **Bundles travel; runtimes materialize.** A bundle carries `ResolvedTemplate` / `ResolvedLoadout` data. Runtime-specific outputs (CLAUDE.md, Gemini config, etc.) are generated client-side at hydrate time.
6. **Hash-stickiness.** Once an agent registers under a hash, that hash is fixed for its lifetime. New spawns pick up new hashes.

## The Resources

### `TeamBundle`

The serialized form of `ResolvedTemplate`, plus everything needed to reproduce its prompts and skills without further filesystem access.

```typescript
interface TeamBundle {
  bundleVersion: 1;
  hash: string;                          // sha256 of canonicalized payload

  name: string;
  version: string;

  manifest: ResolvedTemplate["manifest"];
  roles: Record<string, ResolvedRole>;

  // Loadouts referenced by roles. Each entry includes its own standalone hash
  // so it can also be addressed independently — see LoadoutBundle below.
  loadouts: Record<string, EmbeddedLoadout>;

  prompts: Record<string, string>;       // path → markdown body
  skillCatalog: string;
  rolePrompts: Record<string, string>;   // role name → ROLE.md body

  publishedAt?: string;
  publisher?: { id: string; signature?: string };
  description?: string;
}

interface EmbeddedLoadout {
  hash: string;                          // standalone loadout hash
  resolved: ResolvedLoadout;
  promptAddendum?: string;
}
```

### `LoadoutBundle`

A loadout published independently of any team. Same shape as the embedded form, but addressable on its own.

```typescript
interface LoadoutBundle {
  bundleVersion: 1;
  hash: string;

  name: string;
  version: string;

  resolved: ResolvedLoadout;
  promptAddendum?: string;

  // Optional descriptive metadata for registries/discovery.
  tags?: string[];
  publisher?: { id: string; signature?: string };
  description?: string;
}
```

The merge rules in `src/template/loadout-merge.ts` already produce `ResolvedLoadout`. `bundleLoadout(resolved)` is just *serialize what's already there*.

### Identity: hash + alias

Two URI shapes for loadouts — one team-relative, one standalone:

```
team:sha256:9f3a…                            # canonical team hash
team:gsd@1.4.0                               # team alias

team:sha256:9f3a…/loadout/executor           # team-relative loadout reference
loadout:sha256:abc…                          # standalone loadout hash
loadout:code-reviewer@2.0.0                  # standalone loadout alias
```

Both loadout shapes resolve to the same `ResolvedLoadout`. Team-relative URIs are convenient for orchestrators dispatching within their own team. Standalone URIs unlock:

- **Reuse across teams** — one `code-reviewer` loadout used by three teams, stored once.
- **Ad-hoc agents** — spawn a one-off doc-writer with a loadout, no team context.
- **Registry-style discovery** — "give me any loadout tagged `research`."
- **Independent versioning** — republish a loadout (new MCP server in scope) without republishing every team that references it.

### Canonicalization

Hashes are computed over a canonical JSON serialization:
- Sorted object keys.
- Normalized line endings (LF), trimmed trailing whitespace in prompt bodies.
- Stable iteration order for `roles`, `loadouts`, `prompts`.
- The `hash`, `publishedAt`, `publisher`, and `description` fields are excluded from the hash input.
- Embedded loadout hashes are computed first, then included in the team hash input — so changing a loadout changes the team hash, but two teams that embed the same loadout share its hash.

## Mapping to MAP Primitives

| OpenTeams concern | MAP primitive | Notes |
|---|---|---|
| Team definition | `context` | `kind: openteams.team`, payload is `TeamBundle` |
| Loadout definition | `context` | `kind: openteams.loadout`, payload is `LoadoutBundle` |
| Member lifecycle | task/agent events | `agent_registered`, `agent_state_changed`, `agent_unregistered` — already in `src/runtime/types.ts` |
| Spawn dispatch | `task` | `meta.kind: openteams.spawn`, see below |
| Active-team declaration | task assignment | An agent's MAP identity carries `meta.team` and `meta.role` |

Mapping onto MAP `context` for definitions follows the opentasks pattern: bundles published as MAP contexts get fetch + watch + cache-by-hash for free, the same way opentasks tasks plug into MAP tasks. No custom `team_request/response` verbs needed.

### Spawn dispatch via MAP task

Spawn requests fit naturally onto MAP's existing **task** primitive — the same one [opentasks](https://github.com/alexngai/opentasks) uses:

```jsonc
{
  "id": "spawn-executor-3",
  "status": "open",                                 // → "in_progress" → "completed"
  "meta": {
    "kind":     "openteams.spawn",
    "team":     "team:sha256:9f3a…",
    "role":     "executor",
    "label":    "executor-3",
    "loadout":  "team:sha256:9f3a…/loadout/executor",
    "target":   { "runtime": "claude-code", "placement": { "zone": "edge" } },
    "parent":   "gsd-orchestrator"
  }
}
```

A worker pool subscribes to `kind: openteams.spawn` tasks. When it picks one up:

1. Fetch team bundle if not cached (`get` on the MAP context).
2. Resolve the loadout URI to a `ResolvedLoadout`.
3. Materialize for the worker's runtime (CLAUDE.md, Gemini config, etc.).
4. Boot the child agent.
5. Child emits `agent_registered { team, role, label, agentId }`.
6. Worker marks the spawn task `completed`, with `meta.agentId` filled in.

The orchestrator's `TeamState` updates via the existing event path — no custom dispatch protocol needed.

### Loadout-only dispatch (ad-hoc)

The same task shape works without a team:

```jsonc
{
  "meta": {
    "kind":    "openteams.spawn",
    "loadout": "loadout:sha256:abc…",
    "label":   "doc-writer-1",
    "target":  { "runtime": "claude-code" }
  }
}
```

No `team` field → the spawned agent is a free-standing agent with that loadout's capabilities. Useful for one-shot tools.

## The Client Interface

A single `MAPTeamClient` interface modeled on opentasks's `MAPTaskClient`. Methods are minimal; capabilities are advertised by which methods are implemented.

```typescript
interface MAPTeamClient {
  // Bundles (over MAP context)
  getTeam(uri: string): Promise<TeamBundle>;
  getLoadout(uri: string): Promise<LoadoutBundle>;
  publishTeam?(bundle: TeamBundle): Promise<void>;
  publishLoadout?(bundle: LoadoutBundle): Promise<void>;
  onBundleEvent?(callback: (event: BundleEvent) => void): () => void;

  // Spawn dispatch (over MAP task)
  requestSpawn?(req: SpawnRequest): Promise<SpawnResult>;
  onSpawnRequest?(callback: (req: SpawnRequest) => void): () => void;

  // Member lifecycle (already MAP-aligned)
  emitMemberEvent?(event: TeamEvent): Promise<void>;
  onMemberEvent?(callback: (event: TeamEvent) => void): () => void;
}
```

Implementations: a MAP SDK `ClientConnection` (hub topology), a `BaseConnection` wrapper (peer topology), or an in-process adapter (same-machine, no network). Same boundary opentasks uses.

Read-only consumers (UI dashboards, observers) implement only the `get*` and `on*` methods. Workers implement `onSpawnRequest` and `emitMemberEvent`. Orchestrators implement `requestSpawn` and `emitMemberEvent`. Publishers implement `publish*`.

## Trust & Hot-Reload

### Trust: enforcement is consumer policy

When a parent dispatches a loadout granting permissions, the receiving runtime needs a policy. OpenTeams doesn't pick one — it provides the bundle format and lets consumers implement any of:

| Policy | Means | Cost |
|---|---|---|
| **Loadout-authoritative** | Hash is signed/trusted; runtime grants exactly what the loadout says | Need a trust system above OpenTeams |
| **Parent-attenuating** | Runtime grants `min(parent.perms, loadout.perms)` | Parent must hold every permission it dispatches |
| **Runtime-policy** | Runtime has its own allow-list; loadout is a request | Most flexible, hardest to reason about |

Bundles carry the *declared* loadout. Runtimes carry the *enforcement policy*. Same separation as `enforcement: permissive | audit | strict` today.

Concretely: `publisher.signature` is opaque to OpenTeams. Hashes are verifiable without trust (recompute and compare). A consumer policy might be "accept any loadout signed by `did:example:alex`" or "only accept hashes pre-registered in `~/.openteams/trusted.json`."

### Hot-reload: sticky for v1

**An agent's loadout hash is fixed for its lifetime.** Same rule as team hashes. New spawns pick up new hashes; in-flight agents don't swap.

This avoids mid-execution permission shifts and matches how `TeamState` already validates events per-template. Two agents on different hashes of the "same" team are, for validation purposes, in different teams.

A `loadout_published` MAP context update lets observers see a new version exists. Consumers decide whether to drain + respawn:

- **Orchestrator drain pattern.** Stop dispatching under the old hash, let in-flight agents finish, new spawns use the new hash.
- **Hot-swap (future).** A `hot_reloadable: true` flag on the loadout could allow running agents to fetch new permissions on the next idle boundary. Out of v1.

## End-to-End Flows

### Flow 1: Cold join

A new agent boots into a swarm where peers already reference a team it doesn't have.

```
peers running with team:sha256:9f3a…
new agent connects to MAP

  ← agent_registered { team: "team:sha256:9f3a…", role: "executor", agentId: … }
  ← agent_registered { team: "team:sha256:9f3a…", role: "verifier",  agentId: … }

new agent: "I don't have 9f3a"
  → MAP context get { kind: "openteams.team", hash: "sha256:9f3a…" }
  ← TeamBundle (cached locally for the session)

new agent: hydrateBundle() → ResolvedTemplate → new TeamState(template)
new agent: applies buffered events retroactively
new agent: emits agent_registered + active-team declaration
```

Buffering during fetch is the consumer's responsibility — `TeamState.applyEvent()` rejects events for unknown teams, so callers must hold them until hydrate completes.

### Flow 2: Cross-runtime spawn

The centering use case, end to end. Orchestrator on Claude Code (machine A) dispatches an executor; worker pool on a different runtime (machine B) materializes it.

```
orchestrator (machine A, claude-code):
  has TeamState for team:sha256:9f3a
  resolves: roles.executor.loadout → ResolvedLoadout (in-memory)

  → MAP task create {
      meta: {
        kind:    "openteams.spawn",
        team:    "team:sha256:9f3a…",
        role:    "executor",
        label:   "executor-3",
        loadout: "team:sha256:9f3a…/loadout/executor",
        target:  { runtime: "gemini", placement: { zone: "edge" } }
      }
    }

worker pool (machine B, gemini runtime) picks up the task:
  has team bundle? no →
    ← MAP context get { hash: "sha256:9f3a…" } → TeamBundle
  resolve loadout URI → ResolvedLoadout
  materialize for gemini (runtime-specific config)
  boot child agent

child agent boots:
  → agent_registered { team: "team:sha256:9f3a…", role: "executor", label: "executor-3", agentId: "gemini-7" }

worker:
  → MAP task update { taskId: "spawn-executor-3", status: "completed", meta.agentId: "gemini-7" }

orchestrator's TeamState receives the registered event via existing event path
```

The orchestrator's dispatch is two MAP calls: create task, await completion. The worker's machinery (fetch, materialize, boot) all happens behind the task lifecycle. Member event validation works unchanged because both sides agree on hash `9f3a`.

### Flow 3: Loadout republish + drain

Publisher updates a loadout (e.g. adds an MCP server to scope). Running agents stay on the old hash; new spawns pick up the new one.

```
state: 5 executors running with loadout:sha256:abc
       (referenced as team:sha256:9f3a/loadout/executor)

publisher republishes:
  → MAP context publish { kind: "openteams.team", bundle: TeamBundle }
    new team hash: sha256:bb12 (because embedded loadout changed)
    new loadout hash: sha256:def
  → MAP context publish { kind: "openteams.loadout", bundle: LoadoutBundle (def) }
  → alias update: team:gsd@latest now points at sha256:bb12

orchestrator (running on 9f3a):
  ← bundle event: new team hash for gsd
  policy: drain
  stops dispatching openteams.spawn tasks under team:9f3a
  in-flight executors finish their work, emit agent_unregistered
  next dispatch uses team:bb12

result: graceful transition, no mid-execution permission changes
```

The protocol does nothing special here — this is just the consumer applying the hash-stickiness rule on top of normal MAP context updates.

## Relationship to Existing Runtime

`src/runtime/team-state.ts` already consumes a `ResolvedTemplate` to validate member events. Sync layer adds one step in front:

```
peer publishes → consumer fetches bundle → consumer hydrates ResolvedTemplate
                                         → consumer constructs TeamState(template)
                                         → existing event validation works unchanged
```

```typescript
const bundle = await mapTeamClient.getTeam("team:sha256:9f3a…");
const template = hydrateBundle(bundle);                    // TeamBundle → ResolvedTemplate
const team = new TeamState(bundle.name, template);
mapTeamClient.onMemberEvent((e) => team.applyEvent(e));
```

For multi-team swarms, a `SwarmState` aggregate routes events by their team URI to the right `TeamState`. `SwarmState` is a future runtime construct — not part of v1 sync.

## What This Is *Not*

- **Not a registry.** OpenTeams stores and references bundles; it doesn't host them. A registry (npm-for-teams) is a separate layer that maps aliases → hashes and serves bytes.
- **Not federation.** Federation (`docs/federated-teams-design.md`) composes multiple teams into one runtime topology. Sync distributes the *definition* of any single team or loadout. Federation will consume sync once both exist; a federation manifest will likely be its own bundle type.
- **Not editable state.** Live edits to a published bundle are not a thing. Editing produces a new hash. Aliases can move, hashes cannot.
- **Not a transport.** OpenTeams ships the bundle format and the `MAPTeamClient` interface. Consumers ship the radio (MAP SDK ClientConnection, BaseConnection wrapper, in-process adapter, etc.).
- **Not a replacement for `template install`.** `openteams template install <repo>` still works for git-based distribution. Sync is the peer-to-peer/runtime-discovery path; install is the developer-workflow path. They produce the same `ResolvedTemplate`.
- **Not new protocol.** Bundles ride MAP `context`, spawns ride MAP `task`, member events already align. OpenTeams ships typed payloads on existing primitives.

## Proposed Module Layout

```
src/sync/
  bundle.ts          # bundleTeam(template, opts): TeamBundle
                     # bundleLoadout(loadout, opts): LoadoutBundle
                     # hydrateBundle(bundle): ResolvedTemplate
                     # hydrateLoadout(bundle): ResolvedLoadout
                     # canonicalize() + hash()
  client.ts          # MAPTeamClient interface (abstraction boundary)
  spawn.ts           # SpawnRequest / SpawnResult types,
                     # encode/decode for MAP task meta
  uri.ts             # parse/format team:sha256:… team:name@version
                     # team:<hash>/loadout/<name>  loadout:sha256:… loadout:name@version
  types.ts           # TeamBundle, LoadoutBundle, EmbeddedLoadout, BundleEvent
  bundle.test.ts     # round-trip: template → bundle → template (deep equal)
                     # canonicalization: same input, different machines, same hash
                     # embedded loadout hash matches standalone loadout hash
```

No transport code in `src/sync/` — MAP wiring lives in the consumer. OpenTeams ships the bundle format, the URI scheme, the spawn payload schema, and the client interface; consumers ship the radio.

## Open Questions

1. **Prompt bodies inline vs. by-reference.** Inline keeps bundles self-contained at the cost of size. By-reference (each prompt is its own hash, bundle holds references) enables dedup across teams that share prompts. Recommendation: inline for v1.
2. **MCP server refs (`{ ref: "@org/foo" }`).** Bundles travel between machines whose MCP registries differ. `findMissingMcpReferences()` should run at hydrate time and surface warnings in `ValidationResult`. Non-fatal.
3. **Extension namespaces** (`macro_agent:`, `gsd:`, etc.). Stay opaque — that's the existing contract. The bundle format passes them through verbatim.
4. **Active-team declaration.** Does an agent need a separate "I'm currently on team X" message, or is it enough to put `team`/`role` in MAP agent metadata + every member event? Probably the latter; revisit if multi-team agents become common.
5. **Alias resolution.** Who resolves `team:gsd@1.4.0` → hash? Out of scope for v1. Aliases are publisher-asserted in the bundle's MAP context metadata; consumers cache locally. A registry layer above OpenTeams can add authoritative resolution.
6. **Materialization caching.** Worker pools repeatedly spawn under the same `(loadout_hash, runtime)` pair. Cache the runtime-specific config keyed on that pair? Likely a worker-side concern, not a bundle concern.
7. **Spawn task standardization.** Should `meta.kind: openteams.spawn` be a versioned schema with its own JSON Schema in `schema/`? Probably yes once a second consumer adopts it.

## Minimal v1 Scope

What's needed to make the centering use case work end-to-end:

1. `bundleTeam()` + `bundleLoadout()` + `hydrateBundle()` + `hydrateLoadout()` + canonical hash, with round-trip tests.
2. `TeamBundle`, `LoadoutBundle`, `EmbeddedLoadout`, `SpawnRequest` types in `src/sync/types.ts`, exported from `src/index.ts`.
3. `MAPTeamClient` interface in `src/sync/client.ts` — interface only, no implementations.
4. URI parser/formatter for the four shapes (team-hash, team-alias, loadout-hash, loadout-alias, plus team-relative loadout path).
5. CLI: `openteams bundle <template-dir>` → writes `<hash>.teambundle.json`. `openteams bundle-loadout <template-dir> <loadout-name>` → writes `<hash>.loadoutbundle.json`.
6. Worked example: `examples/loadout-demo` bundled and hydrated, round-trip equal.

Everything else — registries, signatures, hot-swap, transport implementations, federation bundles, `SwarmState` — stays out until a consumer needs it.
