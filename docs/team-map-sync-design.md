# Teams as MAP-Syncable Resources — Design Exploration

> Status: **Exploration** — not a spec, not committed to. This document sketches what it could look like to publish OpenTeams loadouts and team templates as content-addressed, syncable resources over MAP, with **cross-runtime agent dispatch** as the centering use case.

## The Centering Use Case

An orchestrator running on machine A (Claude Code) decides it needs an `executor`. The pool worker that picks up the spawn is on machine B (could be Gemini, Codex, or a custom runtime). The minimum the worker needs to boot a meaningful agent is the role's **loadout** — capabilities, permissions, MCP scope, prompt addendum. That loadout has to travel by reference, not by value, because the orchestrator already holds the resolved form and shouldn't have to ship bytes on every spawn.

Today, no part of this travels over the wire. Templates and loadouts live on disk in the agent system that loaded them. Member events from `src/runtime/` reference roles by name only — meaningful only against a manifest the receiver already has out-of-band.

Publishing the loadout (and, when needed, the team) as a content-addressed MAP resource closes the loop: orchestrators dispatch by URI, workers fetch what they don't have, validation works against the exact bundle the publisher used.

## Design Principles

1. **Minimal footprint.** Most agents need only their own loadout. Heavier constructs (full team manifest, multi-team aggregate) load only when an agent's job actually requires them.
2. **Definition stays definitional.** Synced artifacts are immutable resolved snapshots. Edits happen in files via the CLI, then a new snapshot is published.
3. **Content-addressed.** Resources are identified by hash. Names and versions are aliases that point at hashes.
4. **Loadouts are first-class.** A loadout has its own bundle, its own URI, its own lifecycle. A team is a *composition* of loadouts plus topology and communication — but the team bundle is for *coordinators*, not every participant.
5. **Reuse MAP primitives — don't invent verbs or events.** Bundles ride MAP `context`. Spawn dispatch rides MAP `task`. Agent registration and state events ride MAP's existing agent primitives. OpenTeams contributes typed payloads and metadata fields.
6. **Bundles travel; runtimes materialize.** Bundles carry resolved data; runtime-specific outputs (CLAUDE.md, Gemini config, etc.) are generated client-side at hydrate time.
7. **Hash-stickiness.** Once an agent registers under a hash, that hash is fixed for its lifetime.

## Manifestation Tiers

Not every agent loads the same thing. The protocol supports four tiers; choose the lightest that fits the agent's job.

| Tier | Loads | Who fits |
|---|---|---|
| **0. Loadout-only** | Its own `LoadoutBundle` | Most spawned executors. Boot, do work, emit state events, exit. |
| **1. Loadout + role context** | Loadout + (optionally) the team for self-validation of own emissions | Agents that emit on channels and want to check before sending |
| **2. Full team** | Whole `TeamBundle` + a `TeamState` | Orchestrators, bridges — anyone dispatching or routing |
| **3. Multi-team** | Multiple `TeamBundle`s + a `SwarmState` aggregate | Federation bridges, cross-team observers |

The team bundle remains a first-class MAP resource — its primary consumer is the coordination layer, not every agent. Leaves stay lightweight.

## The Resources

### `LoadoutBundle` — primary

A `LoadoutBundle` is what every spawned agent receives, directly or by reference. It's the serialized form of `ResolvedLoadout`.

```typescript
interface LoadoutBundle {
  bundleVersion: 1;
  hash: string;                          // sha256 of canonicalized payload

  name: string;
  version: string;

  resolved: ResolvedLoadout;             // capabilities, MCP scope, permissions, skills config
  promptAddendum?: string;

  tags?: string[];                       // for registry-style discovery
  publisher?: { id: string; signature?: string };
  description?: string;
}
```

The merge rules in `src/template/loadout-merge.ts` already produce `ResolvedLoadout`. `bundleLoadout(resolved)` is just *serialize what's already there*.

### `TeamBundle` — for coordinators

A `TeamBundle` is what orchestrators, bridges, and observers load to reason about topology, channels, and routing. Leaf agents don't load this.

```typescript
interface TeamBundle {
  bundleVersion: 1;
  hash: string;

  name: string;
  version: string;

  manifest: ResolvedTemplate["manifest"];
  roles: Record<string, ResolvedRole>;

  // Loadouts referenced by roles. Each entry includes its own standalone hash
  // so the same bytes are addressable independently.
  loadouts: Record<string, EmbeddedLoadout>;

  prompts: Record<string, string>;
  skillCatalog: string;
  rolePrompts: Record<string, string>;

  publishedAt?: string;
  publisher?: { id: string; signature?: string };
  description?: string;
}

interface EmbeddedLoadout {
  hash: string;
  resolved: ResolvedLoadout;
  promptAddendum?: string;
}
```

Embedded loadout hashes are computed first, then included in the team hash input. Two teams that embed the same loadout share its hash.

### Identity: hash + alias

```
loadout:sha256:abc…                          # standalone, content-hashed   (primary)
loadout:code-reviewer@2.0.0                  # standalone alias

team:sha256:9f3a…                            # team hash                    (coordinator-only)
team:gsd@1.4.0                               # team alias
team:sha256:9f3a…/loadout/executor           # team-relative loadout reference
```

The team-relative form resolves to the same `ResolvedLoadout` as the embedded loadout's standalone hash — it's a path-style alias for convenience inside team-aware contexts.

### Canonicalization

Hashes are computed over canonical JSON: sorted keys, normalized line endings (LF), trimmed trailing whitespace in prompt bodies, stable iteration order. The `hash`, `publishedAt`, `publisher`, and `description` fields are excluded from hash input. Same input on different machines ⇒ same hash.

## Mapping to MAP Primitives

OpenTeams ships zero new wire protocol — only typed payloads and metadata on existing MAP primitives.

| OpenTeams concern | MAP primitive | Notes |
|---|---|---|
| Loadout definition | `context` | `kind: openteams.loadout`, payload is `LoadoutBundle` |
| Team definition | `context` | `kind: openteams.team`, payload is `TeamBundle` |
| Spawn dispatch | `task` | `meta.kind: openteams.spawn`, see below |
| Agent registration | MAP's agent primitive | OpenTeams contributes metadata fields (`loadout`, optionally `role`/`team`) |
| Member state events | MAP's agent state primitives | Coordinators translate into `TeamEvent` on the consumer side |

OpenTeams **does not define new agent events**. The `TeamEvent` types in `src/runtime/types.ts` are coordinator-side abstractions over MAP's agent events — what `TeamState` consumes after a runtime adapter translates from MAP. Agents themselves register and update state via MAP's existing primitives.

### Metadata fields on agent registration

When an OpenTeams-aware agent registers with MAP, it includes:

| Field | Required | Meaning |
|---|---|---|
| `loadout` | yes | Loadout URI (`loadout:sha256:…` or `team:<hash>/loadout/<name>`). This is the agent's identity for OpenTeams purposes. |
| `role` | optional | Role name from a team. Present when the agent was spawned in team context. |
| `team` | optional | Team URI. Present when the agent participates in a team and a coordinator needs to associate it. |
| `parent` | optional | The spawning agent's MAP id. Lets observers reconstruct hierarchies. |

`team` is deliberately optional. Agent-to-team association is otherwise reconstructable from the spawn task's `meta.team` — that's MAP's job, not OpenTeams's.

### Spawn dispatch via MAP task

```jsonc
{
  "id": "spawn-executor-3",
  "status": "open",                                 // → "in_progress" → "completed"
  "meta": {
    "kind":     "openteams.spawn",
    "loadout":  "loadout:sha256:abc…",              // required
    "role":     "executor",                          // optional, team context
    "team":     "team:sha256:9f3a…",                 // optional, team context
    "label":    "executor-3",
    "target":   { "runtime": "claude-code", "placement": { "zone": "edge" } },
    "parent":   "gsd-orchestrator"
  }
}
```

A worker pool subscribes to `kind: openteams.spawn` tasks. When it picks one up:

1. Fetch the loadout bundle if not cached (MAP context get on the loadout URI).
2. *Optional:* fetch the team bundle if the worker materializes Tier 1+ for this child.
3. Materialize for the worker's runtime.
4. Boot the child agent.
5. Child registers with MAP, including the metadata fields above.
6. Worker marks the spawn task `completed`, with `meta.agentId` filled in.

The orchestrator's `TeamState` (if it has one) sees the agent come up via MAP's agent events — no custom dispatch protocol needed.

### Loadout-only dispatch (the common case)

The spawn task without `team` and `role` is the dominant flow for ad-hoc and leaf agents:

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

The spawned agent is free-standing with that loadout's capabilities. No team manifestation on either side.

## The Client Interface

A single `MAPTeamClient` interface modeled on opentasks's `MAPTaskClient`. Methods are minimal; capabilities are advertised by which methods are implemented. Most agents only use `getLoadout`.

```typescript
interface MAPTeamClient {
  // Loadouts (the common case)
  getLoadout(uri: string): Promise<LoadoutBundle>;
  publishLoadout?(bundle: LoadoutBundle): Promise<void>;

  // Teams (coordinators only)
  getTeam?(uri: string): Promise<TeamBundle>;
  publishTeam?(bundle: TeamBundle): Promise<void>;

  // Bundle update notifications (optional, for hot-reload observers)
  onBundleEvent?(callback: (event: BundleEvent) => void): () => void;

  // Spawn dispatch (over MAP task)
  requestSpawn?(req: SpawnRequest): Promise<SpawnResult>;
  onSpawnRequest?(callback: (req: SpawnRequest) => void): () => void;
}
```

Implementations: a MAP SDK `ClientConnection` (hub), a `BaseConnection` wrapper (peer), or an in-process adapter (same-machine, no network). Same boundary opentasks uses.

Read-only consumers (UI dashboards) implement only the `get*` and `onBundleEvent` methods. Workers implement `onSpawnRequest`. Orchestrators implement `requestSpawn`. Publishers implement `publish*`.

## Trust & Hot-Reload

### Trust: enforcement is consumer policy

When a parent dispatches a loadout granting permissions, the receiving runtime needs a policy. OpenTeams provides the bundle format; consumers implement any of:

| Policy | Means | Cost |
|---|---|---|
| **Loadout-authoritative** | Hash is signed/trusted; runtime grants exactly what the loadout says | Need a trust system above OpenTeams |
| **Parent-attenuating** | Runtime grants `min(parent.perms, loadout.perms)` | Parent must hold every permission it dispatches |
| **Runtime-policy** | Runtime has its own allow-list; loadout is a request | Most flexible, hardest to reason about |

Bundles carry the *declared* loadout. Runtimes carry the *enforcement policy*. `publisher.signature` is opaque to OpenTeams. Hashes are verifiable without trust.

### Hot-reload: sticky for v1

**An agent's loadout hash is fixed for its lifetime.** New spawns pick up new hashes; in-flight agents don't swap.

A `loadout_published` MAP context update lets observers see a new version exists. Consumers decide whether to drain + respawn:

- **Orchestrator drain pattern.** Stop dispatching under the old hash, let in-flight finish, new spawns use the new hash.
- **Hot-swap (future).** A `hot_reloadable: true` flag could allow running agents to fetch new permissions on the next idle boundary. Out of v1.

## End-to-End Flows

### Flow 1: Leaf executor lifecycle (the common case)

A spawned executor that does its work and exits without ever loading a team.

```
worker pool picks up MAP task:
  ← { meta: { kind: "openteams.spawn", loadout: "loadout:sha256:abc", label: "exec-3", … } }
  
  has loadout in cache? no →
    ← MAP context get { kind: "openteams.loadout", hash: "sha256:abc" }
    → LoadoutBundle
  
  materialize for the worker's runtime
  boot child agent

child agent boots:
  → MAP agent register {
      loadout: "loadout:sha256:abc",
      role:    "executor",          // optional context from spawn task
      team:    "team:sha256:9f3a",  // optional context from spawn task
      parent:  "gsd-orchestrator"
    }
  
  agent runs to completion
  → MAP agent state: in_progress → completed
  → MAP agent unregister

worker marks spawn task completed
```

The leaf never fetches the team bundle. Never builds a `TeamState`. Just does its job.

### Flow 2: Coordinator dispatch + manifestation

An orchestrator manifests a team so it can dispatch and route.

```
orchestrator boots:
  ← MAP context get { kind: "openteams.team", hash: "sha256:9f3a" } → TeamBundle
  hydrateBundle() → ResolvedTemplate
  new TeamState(template)
  subscribes to MAP agent events for team:sha256:9f3a participants

orchestrator decides to spawn executor-3:
  resolves locally: roles.executor.loadout → loadout:sha256:abc
  → MAP task create {
      meta: {
        kind: "openteams.spawn",
        loadout: "loadout:sha256:abc",
        team:    "team:sha256:9f3a",
        role:    "executor",
        label:   "executor-3",
        target:  { runtime: "gemini" },
        parent:  "gsd-orchestrator"
      }
    }

worker on machine B materializes (Flow 1 path), boots child
child registers with MAP including loadout/role/team metadata

orchestrator's TeamState picks up the registration via MAP agent events
(translated by the runtime adapter into a TeamEvent)
```

The orchestrator is the only side that loads the team bundle. The worker can choose to fetch it (Tier 1) or not (Tier 0) depending on its runtime needs.

### Flow 3: Loadout republish + drain

```
state: 5 executors running with loadout:sha256:abc
       (referenced as team:sha256:9f3a/loadout/executor inside team gsd@1.4.0)

publisher republishes loadout:
  → MAP context publish { kind: "openteams.loadout", bundle: LoadoutBundle (def) }
  → MAP context publish { kind: "openteams.team",    bundle: TeamBundle (bb12) }
    (team hash changes because embedded loadout changed)
  → alias update: team:gsd@latest → team:sha256:bb12

orchestrator (running on team:9f3a):
  ← bundle event: new team hash for gsd
  policy: drain
  stops dispatching openteams.spawn tasks under team:9f3a
  in-flight executors finish their work, unregister normally
  next dispatch uses team:bb12 / loadout:def

leaf agents see nothing — they're already on their hash, doing their work, will exit normally
```

The protocol does nothing special here — the consumer applies hash-stickiness on top of normal MAP context updates. Leaf agents are unaffected because they never loaded the team in the first place.

## Relationship to Existing Runtime

`src/runtime/team-state.ts` already consumes a `ResolvedTemplate` to validate member events. Sync layer adds one step in front *for coordinators*:

```typescript
const bundle = await mapTeamClient.getTeam("team:sha256:9f3a…");
const template = hydrateBundle(bundle);                    // TeamBundle → ResolvedTemplate
const team = new TeamState(bundle.name, template);
mapAdapter.onAgentEvent((mapEvent) => {
  const teamEvent = translateAgentEvent(mapEvent);          // MAP event → TeamEvent
  team.applyEvent(teamEvent);
});
```

`TeamEvent` and `TeamState` stay coordinator-side abstractions. They're not on the wire — they're how a runtime adapter presents MAP agent events to OpenTeams's validation layer.

For multi-team coordinators, a `SwarmState` aggregate routes events by team URI to the right `TeamState`. `SwarmState` is a future construct — not part of v1 sync.

## What This Is *Not*

- **Not every agent's concern.** Most agents need only their loadout. Team manifestation is for coordinators.
- **Not a new event protocol.** Member events ride MAP's agent primitives. OpenTeams contributes metadata fields, not new event types.
- **Not a registry.** OpenTeams stores and references bundles; it doesn't host them. A registry layer (npm-for-loadouts) is separate.
- **Not federation.** Federation (`docs/federated-teams-design.md`) composes multiple teams into one runtime topology. Sync distributes the *definition* of any single team or loadout. Federation will consume sync once both exist.
- **Not editable state.** Live edits to a published bundle don't exist. Editing produces a new hash.
- **Not a transport.** OpenTeams ships the bundle format and the `MAPTeamClient` interface. Consumers ship the radio.
- **Not a replacement for `template install`.** `openteams template install <repo>` still works for git-based distribution. Sync is the peer-to-peer/runtime path; install is the developer-workflow path. Same `ResolvedTemplate` either way.

## Proposed Module Layout

```
src/sync/
  bundle.ts          # bundleLoadout(loadout, opts): LoadoutBundle
                     # bundleTeam(template, opts): TeamBundle
                     # hydrateLoadout(bundle): ResolvedLoadout
                     # hydrateBundle(bundle): ResolvedTemplate
                     # canonicalize() + hash()
  client.ts          # MAPTeamClient interface (abstraction boundary)
  spawn.ts           # SpawnRequest / SpawnResult types,
                     # encode/decode for MAP task meta
  uri.ts             # parse/format loadout:sha256:…  loadout:name@version
                     # team:sha256:…  team:name@version  team:<hash>/loadout/<name>
  types.ts           # LoadoutBundle, TeamBundle, EmbeddedLoadout, BundleEvent,
                     # AgentMetadata (the metadata fields on MAP registration)
  bundle.test.ts     # round-trip tests, canonicalization tests, hash equivalence tests
```

No transport code in `src/sync/` — MAP wiring lives in the consumer.

## Open Questions

1. **Communication context.** Tier 1 agents (self-validate own emissions) need their role's subscriptions/emissions slice. *Resolved:* communication context flows through other channels — not folded into the loadout. OpenTeams stays config/permissions-focused; comms is a separate concern.
2. **Optional `team` field on agent registration.** *Resolved:* keep it optional. Agents include it when convenient; coordinators reconstruct membership from spawn task `meta.team` otherwise.
3. **Agent-to-team mapping.** *Resolved:* MAP's job, not OpenTeams's. Agent registration and discovery live in MAP; OpenTeams just contributes metadata payloads.
4. **Standalone-loadout dispatch as the general case.** *Resolved:* yes. Leaf agents are the dominant flow; team-context fields on the spawn task are optional.
5. **Prompt bodies inline vs. by-reference.** Inline keeps bundles self-contained at the cost of size. By-reference enables dedup. Recommendation: inline for v1.
6. **MCP server refs (`{ ref: "@org/foo" }`).** Bundles travel between machines whose MCP registries differ. `findMissingMcpReferences()` should run at hydrate time and surface warnings non-fatally.
7. **Materialization caching.** Worker-side concern. A worker repeatedly spawning under `(loadout_hash, runtime)` should cache its rendered config. Not a bundle concern.
8. **Spawn task standardization.** Should `meta.kind: openteams.spawn` get a versioned JSON Schema in `schema/`? Probably yes once a second consumer adopts it.

## Minimal v1 Scope

What's needed to make the centering use case work end-to-end:

1. `bundleLoadout()` + `hydrateLoadout()` + canonical hash, with round-trip tests. **Loadout is the core deliverable.**
2. `bundleTeam()` + `hydrateBundle()` for coordinators, with round-trip tests. Embedded loadout hash equals standalone loadout hash (verified by test).
3. URI parser/formatter for loadout and team URI shapes.
4. `LoadoutBundle`, `TeamBundle`, `EmbeddedLoadout`, `SpawnRequest`, `AgentMetadata` types in `src/sync/types.ts`, exported from `src/index.ts`.
5. `MAPTeamClient` interface in `src/sync/client.ts` — interface only, no implementations.
6. CLI: `openteams bundle-loadout <template-dir> <loadout-name>` → `<hash>.loadoutbundle.json`. `openteams bundle <template-dir>` → `<hash>.teambundle.json`.
7. Worked example: `examples/loadout-demo` round-trips through both bundle types.

Everything else — registries, signatures, hot-swap, transport implementations, federation bundles, `SwarmState`, communication-context publishing — stays out until a consumer needs it.
