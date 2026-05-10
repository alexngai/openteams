# MAP Integration — Hub Wiring & Optional SDK Improvements

> Status: **Draft** — written from OpenTeams's perspective. Describes the no-SDK-change wiring path and a separate set of optional improvements the MAP SDK could absorb if multiple kind packages adopt the same pattern.

## Summary

OpenTeams integrates with MAP using only the SDK's existing surface — **no SDK changes required**. The MAP Resource Protocol v1 is documented, and the protocol's method registry, capability advertisement, and `additionalHandlers` mechanism are already in place. OpenTeams ships kind handlers and a hub-side wiring helper; consumers integrate with one function call.

This document covers:

- **The wiring path** — what OpenTeams ships today and how a hub plugs it in.
- **Optional SDK improvements** — small additions the MAP SDK could absorb later to reduce per-kind boilerplate. None required.

## Wiring path (no SDK changes)

### What OpenTeams ships

```
src/sync/
  types.ts       — LoadoutResource, TeamResource (extending the spec's
                   MAPResource shape), AgentMetadata, SpawnRequest,
                   ResourceKindHandler (local copy matching the spec)
  bundle.ts      — bundleLoadout / bundleTeam / hydrateLoadout / hydrateBundle
                   canonicalize, hash, verifyHash. Pure functions.
  handlers.ts    — createLoadoutKindHandler({ store, emit? }): ResourceKindHandler
                   createTeamKindHandler({ store, emit? }): ResourceKindHandler
                   composeResourceHandlers(handlers): { handlers, kinds }
  store.ts       — InMemoryBundleStore — reference implementation of BundleStore
  client.ts      — createOpenTeamsClient(mapClient, { events? }): OpenTeamsClient
                   typed getLoadout / getTeam / publishLoadout / publishTeam,
                   thin wrapper over map/resources/get + event bus subscribe
  spawn.ts       — encode/decode for MAP task meta
```

Everything in `src/sync/` is either a pure function or accepts an existing MAP server/client by reference. No transport in the package itself.

### How a hub integrates

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import {
  composeResourceHandlers,
  createLoadoutKindHandler,
  createTeamKindHandler,
  InMemoryBundleStore,
} from "@openteams/sync";

const store = new InMemoryBundleStore();    // or your own backend
const composed = composeResourceHandlers([
  createLoadoutKindHandler({ store }),
  createTeamKindHandler({ store }),
]);

const server = new MAPServer({
  capabilities: { resources: { enabled: true, kinds: composed.kinds } },
  additionalHandlers: composed.handlers,
});
```

`composeResourceHandlers` is a pure function:

1. Returns a `handlers` map ready for `MAPServer.additionalHandlers`. The `map/resources/list` and `map/resources/get` entries route by `params.type` to the registered kind handler.
2. For each kind handler that exposes `publish`, installs a `<type>/publish` method.
3. Returns the `kinds` array to advertise via `capabilities.resources.kinds`.
4. Throws on duplicate kind registration.

Hubs that already register `map/resources/list` / `get` themselves (e.g. for non-OpenTeams kinds) compose their own handler maps; they pick the routing strategy that fits their setup.

### How an agent fetches

```typescript
import { createOpenTeamsClient } from "@openteams/sync";

const client = createOpenTeamsClient(mapClient, { events: mapClient });
const loadout  = await client.getLoadout("sha256:abc");      // → LoadoutResource
const template = await client.getTeam!("sha256:9f3a");       // → TeamResource

const unsub = client.onBundleEvent!((evt) => {
  if (evt.resource_type === "x-openteams/loadout" && evt.type === "resource.updated") {
    // …
  }
});
```

`createOpenTeamsClient` returns an `OpenTeamsClient` whose methods wrap typed calls into `map/resources/get` and the kind-specific `<type>/publish` and `<type>/remove` methods:

| Method | Wraps |
|---|---|
| `getLoadout(idOrRef)` / `getTeam(idOrRef)` | `map/resources/get { type, id }` |
| `publishLoadout(bundle)` / `publishTeam(bundle)` | `<type>/publish { bundle }` — emits `resource.added` / `resource.updated` |
| `removeLoadout(idOrRef)` / `removeTeam(idOrRef)` | `<type>/remove { id }` → `{ removed: boolean }` — emits `resource.removed` when found |
| `onBundleEvent(cb)` | filters the event subscription to OpenTeams resource types |
| `requestSpawn(req)` | `map/tasks/create` with `meta.kind = "openteams.spawn"`, then waits on `task.completed` / `task.status` |
| `onSpawnRequest(cb)` | filters `task.created` events by `isSpawnTaskMeta(meta)` |

Pass `events` to enable `onBundleEvent`, `onSpawnRequest`, and `requestSpawn`'s completion-waiting behavior; without it those methods are omitted (or `requestSpawn` resolves immediately with `status: "open"`).

**`requestSpawn` portability note.** The orchestrator-side implementation generates the task id client-side (`spawn-${randomUUID()}`) and passes it to `map/tasks/create`. This lets the completion listener filter on the id *before* the create call's events fire — without it, a worker that flips status synchronously can race ahead of listener registration. The MAP spec permits client-supplied task ids (`TasksCreateRequestParams.task.id?: TaskId`). If you target a server that auto-reassigns ids on create, wrap this client and look up the assigned id from the create response.

### Events without SDK helpers

Handlers emit lifecycle events on the SDK's existing event bus. The payload follows the spec's `ResourceEvent` shape verbatim:

```typescript
server.eventBus.emit({
  type: "resource.added",
  data: {
    resource_type: "x-openteams/loadout",
    resource_id:   bundle.id,
    resource_name: bundle.name,
    origin_hub_id: null,
    timestamp:     new Date().toISOString(),
  },
});
```

Subscribers filter client-side. If the SDK later adds `resources:<type>` scope channel routing, the payload is unchanged — only the subscription shape moves from "all `resource.*` events, filter on `data.resource_type`" to "only events on `resources:x-openteams/loadout`."

### Rough edges

Real but small; don't block shipping:

- **Multi-kind cooperation by wrapping.** If another kind package also installs `map/resources/list`, OpenTeams's helper wraps it. Additive cooperation works (each package routes its own types, falls through). Fragile if a third package introduces incompatible behavior — addressable by SDK improvement 2 below.
- **Client-side event filtering.** Subscribers receive every `resource.*` event and discard the irrelevant ones. Wasteful at high event volume; functionally correct.
- **Per-kind boilerplate.** Each kind package writes its own `wireFooHandlers`. Fine for one or two packages; compounds with more.

## Optional SDK improvements

If multiple kind packages adopt this pattern, the MAP SDK can absorb the wiring helper to reduce duplication. **None of these are required for OpenTeams.**

### 1. Ship the Resource Protocol types

Add `MAPResource`, `ResourceKindHandler`, `ResourceHandlerContext`, `ResourceEvent` to `ts-sdk/src/types/index.ts`. Already defined in the spec; codifying them prevents drift across kind packages. OpenTeams's local copies become re-exports.

**Cost:** ~50 lines of types. Zero behavior change.

### 2. Built-in dispatch

Add `server.registerResourceKind(handler)` and a default dispatcher for `map/resources/list/get`. Replaces hand-rolled wiring helpers across kind packages.

```typescript
server.registerResourceKind(createLoadoutKindHandler({ store }));
server.registerResourceKind(createTeamKindHandler({ store }));
```

**Backwards compat:** default dispatcher only installs if `map/resources/list/get` aren't already in `additionalHandlers`. Existing hubs unaffected.

**Cost:** ~80 lines in `server.ts` + router wiring. Eliminates ~50 lines of wiring helper per kind package.

### 3. Resource event helper + scope channel routing

Add `server.emitResourceEvent(kind, resource)` and route subscriptions on `resources:<type>`, `resources:<namespace>/*`, `resources:*` channels.

**Cost:** ~30 lines of helper + ~20 lines of scope-pattern matching. Replaces client-side filtering.

### 4. Document the kind-specific publish convention

Update `docs/13-resource-protocol.md` with a "Writes" section recommending `<type>/publish`, `<type>/update`, `<type>/remove` for kinds that need writes. Convention only.

**Cost:** ~30 lines of doc.

### Recommended rollout (if MAP wants to absorb these)

- **Stage 1:** types only (item 1). Lowest risk, highest leverage. Kind packages start re-exporting; spec drift goes away.
- **Stage 2:** dispatch (item 2). Kind packages migrate from per-kind wiring helpers.
- **Stage 3:** events + convention (items 3, 4). Adopted as multi-kind hubs become common.

OpenTeams works at every stage, including Stage 0 (no SDK changes).
