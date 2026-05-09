# Teams as MAP Resources — Design Exploration

> Status: **Exploration** — not a spec, not committed to. This document sketches publishing OpenTeams loadouts and team templates as content-addressed resources via the [MAP Resource Protocol v1](https://github.com/alexngai/multi-agent-protocol/blob/main/docs/13-resource-protocol.md), with **cross-runtime agent dispatch** as the centering use case.

## The Centering Use Case

An orchestrator on machine A (Claude Code) decides it needs an `executor`. The pool worker that picks up the spawn is on machine B (Gemini, Codex, or a custom runtime). The minimum the worker needs to boot a meaningful agent is the role's **loadout** — capabilities, permissions, MCP scope, prompt addendum. That loadout has to travel by reference, not by value, because the orchestrator already holds the resolved form and shouldn't have to ship bytes on every spawn.

Today, no part of this travels over the wire. Templates and loadouts live on disk. Member events from `src/runtime/` reference roles by name only — meaningful only against a manifest the receiver already has out-of-band.

Publishing the loadout (and, when needed, the team) as a MAP resource closes the loop: orchestrators dispatch by id, workers fetch what they don't have, validation works against the exact bundle the publisher used.

## Design Principles

1. **Minimal footprint.** Most agents need only their own loadout. Heavier constructs (full team manifest, multi-team aggregate) load only when an agent's job actually requires them.
2. **Definition stays definitional.** Synced artifacts are immutable resolved snapshots. Edits happen in files via the CLI, then a new snapshot is published.
3. **Content-addressed.** Resources are identified by hash. Names and versions are aliases that resolve to hashes.
4. **Loadouts are first-class.** A loadout has its own resource entry, its own id, its own lifecycle. A team is a *composition* of loadouts plus topology — but the team resource is for *coordinators*, not every participant.
5. **Reuse MAP primitives — don't invent verbs or events.** Bundles ride MAP resources. Spawn dispatch rides MAP tasks. Agent registration and state events ride MAP's existing agent primitives.
6. **Bundles travel; runtimes materialize.** Bundles carry resolved data; runtime-specific outputs (CLAUDE.md, Gemini config, etc.) are generated client-side at hydrate time.
7. **Hash-stickiness.** Once an agent registers under a hash, that hash is fixed for its lifetime.

## Manifestation Tiers

Not every agent loads the same thing. The protocol supports four tiers; choose the lightest that fits the agent's job.

| Tier | Loads | Who fits |
|---|---|---|
| **0. Loadout-only** | Its own loadout resource | Most spawned executors. Boot, do work, emit state events, exit. |
| **1. Loadout + role context** | Loadout + (optionally) the team resource for self-validating own emissions | Agents that emit on channels and want to check before sending |
| **2. Full team** | Whole team resource + a `TeamState` | Orchestrators, bridges — anyone dispatching or routing |
| **3. Multi-team** | Multiple team resources + a `SwarmState` aggregate | Federation bridges, cross-team observers |

The team resource remains a first-class MAP entity — its primary consumer is the coordination layer, not every agent. Leaves stay lightweight.

## Mapping to MAP Resource Protocol

OpenTeams contributes two resource kinds and one task `meta` payload. Everything else uses MAP primitives unchanged.

| OpenTeams concept | MAP primitive | Identifier shape |
|---|---|---|
| Loadout definition | `MAPResource` with `type: "x-openteams/loadout"` | `id` = content hash (e.g. `sha256:abc…`) |
| Team definition | `MAPResource` with `type: "x-openteams/team"` | `id` = content hash |
| Bundle fetch | `map/resources/get { type, id }` | — |
| Bundle browse | `map/resources/list { type, filter }` | — |
| Bundle update notifications | `resource.added/updated/removed` on `resources:x-openteams/*` scope channels | — |
| Spawn dispatch | `MAPTask` with `meta.kind: "openteams.spawn"` | — |
| Agent registration | `Participant.metadata` carries `loadout`/`role`/`team`/`parent` | — |

Loadout and team URIs collapse to MAP resource references — `(type, id)` tuples. For embedding inside other payloads (e.g. a spawn task's `meta.loadout`), use the stringified form `x-openteams/loadout:<hash>`. No custom URI scheme.

## The Resources

### `x-openteams/loadout` — primary

The resource every spawned agent receives, directly or by reference. Its `metadata` carries the serialized form of `ResolvedLoadout`.

```jsonc
{
  "id":           "sha256:abc…",                  // content hash
  "type":         "x-openteams/loadout",
  "name":         "code-reviewer",                // human-readable
  "status":       "active",
  "owner_id":     "agent_xyz",
  "origin_hub_id": null,
  "created_at":   "2026-05-07T10:00:00Z",
  "updated_at":   "2026-05-07T10:00:00Z",
  "metadata": {
    "bundleVersion": 1,
    "version":       "2.0.0",
    "resolved":      { /* ResolvedLoadout — includes promptAddendum, capabilities, mcpScope, etc. */ },
    "tags":          ["research"],
    "publisher":     { "id": "did:example:alex", "signature": "..." },
    "description":   "Code reviewer loadout"
  }
}
```

The merge rules in `src/template/loadout-merge.ts` already produce `ResolvedLoadout`. `bundleLoadout(resolved)` is just *serialize what's already there* into this envelope.

### `x-openteams/team` — for coordinators

What orchestrators, bridges, and observers load to reason about topology, channels, and routing. Leaf agents don't load this.

```jsonc
{
  "id":           "sha256:9f3a…",
  "type":         "x-openteams/team",
  "name":         "gsd",
  "status":       "active",
  "owner_id":     "agent_xyz",
  "origin_hub_id": null,
  "created_at":   "2026-05-07T10:00:00Z",
  "updated_at":   "2026-05-07T10:00:00Z",
  "metadata": {
    "bundleVersion": 1,
    "version":       "1.4.0",
    "manifest":      { /* TeamManifest, including mcp_providers */ },
    "roles":         { /* Record<string, ResolvedRole> */ },
    "loadouts":      {
      "executor": { "id": "sha256:abc…", "resolved": { /* ResolvedLoadout */ } }
    },
    "prompts":       { /* role → ResolvedPrompts */ },
    "mcpServers":    { /* role → McpServerEntry[] (legacy role-level) */ },
    "publisher":     { "id": "did:example:alex" }
  }
}
```

Each `loadouts[<name>]` entry carries a content hash (`id`) that equals what `bundleLoadout(resolved).id` produces standalone — the same loadout addressed two ways resolves to the same hash. `mcpProviders` is reconstructed at hydrate time from `manifest.mcp_providers`. Skill catalogs and rendered ROLE prompts are not embedded; consumers regenerate them from the hydrated template via `generateCatalog(template)` / `generateAgentPrompts(template)` if needed.

### Canonicalization

Hashes are computed over a canonical JSON serialization of the bundle payload: sorted keys, stable array order, properties whose value is `undefined` omitted, **strings normalized to NFC Unicode** (so the same accented character produced on macOS NFD and Linux NFC hashes the same), and CRLF line endings normalized to LF. Trailing whitespace is **not** trimmed — Markdown encodes line breaks as two trailing spaces, and trimming would corrupt prompt bodies. Hashes exclude descriptive metadata (`description`, `tags`, `publisher`), the author-controlled `version` label, lifecycle fields (`status`, `created_at`, `updated_at`, `owner_id`, `origin_hub_id`), and (for teams) `mcpProviders` which is reconstructed from `manifest.mcp_providers` at hydrate time. Same template on different machines ⇒ same hash.

## Spawn dispatch via MAP task

```jsonc
{
  "id": "spawn-executor-3",
  "status": "open",                                 // → "in_progress" → "completed"
  "meta": {
    "kind":     "openteams.spawn",
    "loadout":  "x-openteams/loadout:sha256:abc…",  // required
    "role":     "executor",                          // optional, team context
    "team":     "x-openteams/team:sha256:9f3a…",     // optional, team context
    "label":    "executor-3",
    "target":   { "runtime": "claude-code", "placement": { "zone": "edge" } },
    "parent":   "gsd-orchestrator"
  }
}
```

A worker pool subscribes to tasks with `meta.kind: "openteams.spawn"`. When it picks one up:

1. Fetch the loadout resource if not cached: `map/resources/get { type: "x-openteams/loadout", id }`.
2. *Optional:* fetch the team resource if the worker materializes Tier 1+ for this child.
3. Materialize for the worker's runtime.
4. Boot the child agent.
5. Child registers via MAP, including the metadata fields below.
6. Worker marks the spawn task `completed`, with `meta.agentId` filled in.

### Loadout-only dispatch (the common case)

The spawn task without `team` and `role` is the dominant flow for ad-hoc and leaf agents:

```jsonc
{
  "meta": {
    "kind":    "openteams.spawn",
    "loadout": "x-openteams/loadout:sha256:abc…",
    "label":   "doc-writer-1",
    "target":  { "runtime": "claude-code" }
  }
}
```

## Agent registration metadata

When an OpenTeams-aware agent registers with MAP, it includes these fields in its `Participant.metadata`:

| Field | Required | Meaning |
|---|---|---|
| `loadout` | yes | Loadout resource reference (`x-openteams/loadout:<hash>`). The agent's identity for OpenTeams purposes. |
| `role` | optional | Role name from a team. Present when the agent was spawned in team context. |
| `team` | optional | Team resource reference. Present when a coordinator needs to associate the agent. |
| `parent` | optional | The spawning agent's id. Lets observers reconstruct hierarchies. |

`team` is deliberately optional. Agent-to-team association is otherwise reconstructable from the spawn task's `meta.team` — that's MAP's job, not OpenTeams's.

OpenTeams does **not define new agent events**. The `TeamEvent` types in `src/runtime/types.ts` are coordinator-side abstractions over MAP agent state events — what `TeamState` consumes after a runtime adapter translates from MAP.

## What OpenTeams ships

### `ResourceKindHandler` factories

For each kind, OpenTeams exports a handler factory that hubs register with the MAP SDK:

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import {
  composeResourceHandlers,
  createLoadoutKindHandler,
  createTeamKindHandler,
} from "@openteams/sync";

const composed = composeResourceHandlers([
  createLoadoutKindHandler({ store: myLoadoutStore }),
  createTeamKindHandler({ store: myTeamStore }),
]);

const server = new MAPServer({
  capabilities: { resources: { enabled: true, kinds: composed.kinds } },
  additionalHandlers: composed.handlers,
});
```

`composeResourceHandlers` is a pure function that returns a method-handler map suitable for `MAPServer.additionalHandlers` plus the `kinds` list for the capability advertisement. Storage backend is hub-defined — OpenTeams ships an in-memory reference (`InMemoryBundleStore`); production hubs wire their own. See `docs/map-integration.md` for the full integration walk-through.

### Kind-specific publish methods

Per the Resource Protocol's "writes are kind-specific" stance, OpenTeams defines two publish methods that hubs route to the loadout/team handlers:

```
x-openteams/loadout/publish    →  handler.publish(bundle)  →  emits resource.added
x-openteams/team/publish       →  handler.publish(bundle)  →  emits resource.added
```

These are registered as `additionalHandlers` on the MAP server; hub developers don't write the dispatch themselves once the kind handler is registered.

### Bundle types and helpers

```typescript
// Pure functions — no transport, no I/O
bundleLoadout(resolved: ResolvedLoadout, opts): LoadoutResource
bundleTeam(template: ResolvedTemplate, opts): TeamResource
hydrateLoadout(resource: LoadoutResource): ResolvedLoadout
hydrateBundle(resource: TeamResource): ResolvedTemplate
canonicalize<T>(value: T): string
hash(canonical: string): string
verifyHash(resource): boolean
```

### A thin client helper

Most agent-side code wants typed fetches rather than raw `MAPResource` envelopes:

```typescript
import { OpenTeamsClient } from "@openteams/sync";

const client = new OpenTeamsClient(mapClient);              // wraps a MAP client
const loadout = await client.getLoadout("sha256:abc…");     // → ResolvedLoadout
const template = await client.getTeam("sha256:9f3a…");      // → ResolvedTemplate
```

This is a 50-line wrapper around `map/resources/get`; no new transport.

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

A `resource.updated` event on `resources:x-openteams/loadout` lets observers see a new version exists. Consumers decide whether to drain + respawn:

- **Orchestrator drain pattern.** Stop dispatching under the old hash, let in-flight finish, new spawns use the new hash.
- **Hot-swap (future).** A `hot_reloadable: true` flag could allow running agents to fetch new permissions on the next idle boundary. Out of v1.

## End-to-End Flows

### Flow 1: Leaf executor lifecycle (the common case)

A spawned executor that does its work and exits without ever loading a team.

```
worker pool picks up MAP task:
  ← { meta: { kind: "openteams.spawn", loadout: "x-openteams/loadout:sha256:abc", label: "exec-3", … } }

  has loadout cached? no →
    → map/resources/get { type: "x-openteams/loadout", id: "sha256:abc" }
    ← MAPResource (loadout)

  materialize for the worker's runtime
  boot child agent

child agent boots:
  → MAP agent register {
      metadata: {
        loadout: "x-openteams/loadout:sha256:abc",
        role:    "executor",          // optional context from spawn task
        team:    "x-openteams/team:sha256:9f3a",  // optional
        parent:  "gsd-orchestrator"
      }
    }

  agent runs
  → MAP agent state updates as it works
  → MAP agent unregister

worker marks spawn task completed
```

The leaf never fetches the team resource. Never builds a `TeamState`. Just does its job.

### Flow 2: Coordinator dispatch + manifestation

```
orchestrator boots:
  → map/resources/get { type: "x-openteams/team", id: "sha256:9f3a" } → MAPResource
  hydrateBundle() → ResolvedTemplate
  new TeamState(template)
  subscribes to MAP agent events for participants with metadata.team === "team:sha256:9f3a"

orchestrator decides to spawn executor-3:
  resolves locally: roles.executor.loadout → x-openteams/loadout:sha256:abc
  → map/tasks/create {
      meta: {
        kind: "openteams.spawn",
        loadout: "x-openteams/loadout:sha256:abc",
        team:    "x-openteams/team:sha256:9f3a",
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

### Flow 3: Loadout republish + drain

```
state: 5 executors running with loadout id sha256:abc

publisher republishes:
  → x-openteams/loadout/publish { bundle: LoadoutResource (def) }
    hub computes new id: sha256:def, stores, emits resource.added on resources:x-openteams/loadout
  → x-openteams/team/publish { bundle: TeamResource (bb12) }
    (team hash changes because embedded loadout changed)

orchestrator subscribed to resources:x-openteams/team:
  ← resource.updated event
  policy: drain
  stops dispatching openteams.spawn tasks under team:9f3a / loadout:abc
  in-flight executors finish their work, unregister normally
  next dispatch uses team:bb12 / loadout:def

leaf agents see nothing — they're already on their hash, doing their work, will exit normally
```

## MAP Integration

This design works against the **current** MAP SDK with no protocol or SDK changes. OpenTeams ships kind handlers + a hub-side wiring helper that plugs into the SDK's existing `additionalHandlers` mechanism, and a thin client wrapper for agent-side fetches over `map/resources/get`. Lifecycle events ride the SDK's existing event bus with payload conforming to the spec's `ResourceEvent` shape.

See [`docs/map-integration.md`](./map-integration.md) for the wiring path, including a separate, **optional** set of SDK improvements (types, built-in dispatch, scope-channel event routing) that would reduce per-kind boilerplate if multiple kind packages adopt the pattern. None of those are required.

## What This Is *Not*

- **Not every agent's concern.** Most agents need only their loadout. Team manifestation is for coordinators.
- **Not a new event protocol.** Member events ride MAP's agent primitives. OpenTeams contributes metadata fields, not new event types.
- **Not a registry.** Hubs implement storage and access control. A registry layer (npm-for-loadouts) is separate.
- **Not federation.** Federation (`docs/federated-teams-design.md`) composes multiple teams into one runtime topology. Sync distributes the *definition* of any single team or loadout.
- **Not editable state.** Live edits to a published bundle don't exist. Editing produces a new hash.
- **Not a transport.** OpenTeams ships kind handlers and bundle helpers. The MAP SDK ships the wire.
- **Not a replacement for `template install`.** `openteams template install <repo>` still works for git-based distribution.

## Proposed Module Layout

```
src/sync/
  bundle.ts          # bundleLoadout / bundleTeam / hydrateLoadout / hydrateBundle
                     # canonicalize() + hash() + verifyHash()
  handlers.ts        # createLoadoutKindHandler / createTeamKindHandler
                     # in-memory reference store; consumers can swap
  client.ts          # OpenTeamsClient — typed wrapper over a MAP client
  spawn.ts           # SpawnRequest / SpawnResult types + encode/decode for MAP task meta
  types.ts           # LoadoutResource, TeamResource, AgentMetadata, etc.
  bundle.test.ts     # round-trip + canonicalization tests
  handlers.test.ts   # handler factory tests against an in-memory store
```

No transport in `src/sync/`. The handler factories accept a storage abstraction; the client wrapper accepts an existing MAP client. OpenTeams plugs into MAP, doesn't reimplement it.

## Open Questions (resolved & remaining)

1. **Communication context.** *Resolved:* flows through other channels — not folded into the loadout.
2. **Optional `team` field on agent registration.** *Resolved:* keep optional. Coordinators reconstruct membership from spawn task `meta.team` otherwise.
3. **Agent-to-team mapping.** *Resolved:* MAP's job, not OpenTeams's.
4. **Standalone-loadout dispatch as the general case.** *Resolved:* yes.
5. **Wire format / protocol.** *Resolved:* MAP Resource Protocol v1, with three SDK additions.
6. **Prompt bodies inline vs. by-reference.** Inline keeps bundles self-contained at the cost of size. Recommendation: inline for v1.
7. **MCP server refs.** `findMissingMcpReferences()` should run at hydrate time and surface non-fatal warnings.
8. **Materialization caching.** Worker-side concern. Cache rendered config keyed on `(loadout_hash, runtime)`. Not a bundle concern.
9. **Spawn task standardization.** Should `meta.kind: openteams.spawn` get a versioned JSON Schema in `schema/`? Probably yes once a second consumer adopts it.
10. **Hub write-method convention.** `<kind>/publish` is what we propose. Open question: do other kind packages adopt the same pattern, or does each invent its own?

## Minimal v1 Scope

What's needed to make the centering use case work end-to-end:

1. `bundleLoadout()` + `hydrateLoadout()` + canonical hash, with round-trip tests. **The core deliverable.**
2. `bundleTeam()` + `hydrateBundle()` for coordinators, with embedded-vs-standalone hash equivalence tests.
3. `LoadoutResource`, `TeamResource`, `SpawnRequest`, `AgentMetadata` types in `src/sync/types.ts`, exported from `src/index.ts`.
4. `createLoadoutKindHandler` + `createTeamKindHandler` factories with an in-memory reference store.
5. `OpenTeamsClient` wrapper exposing typed `getLoadout` / `getTeam` over a MAP client.
6. CLI: `openteams bundle team <template-dir>` → team resource JSON; `openteams bundle loadout <template-dir> <loadout-name>` → loadout resource JSON; `openteams bundle verify <file>` recomputes and reports. Network publish is left to consumers — they call `OpenTeamsClient.publishLoadout` / `publishTeam` against their MAP setup.
7. Worked example: `examples/loadout-demo` round-trips through both kinds.

Independent of any MAP SDK changes — see [`docs/map-integration.md`](./map-integration.md). All phases can start now.

Everything else — registries, signatures, hot-swap, federation bundles, `SwarmState`, communication-context publishing, materialization caching, trust/PKI — stays out until a consumer needs it.
