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
  handlers.ts    — createLoadoutKindHandler({ store }): ResourceKindHandler
                   createTeamKindHandler({ store }): ResourceKindHandler
                   InMemoryBundleStore — reference implementation
                   wireOpenTeamsHandlers(server, handlers): () => void
  client.ts      — OpenTeamsClient(mapClient): typed getLoadout / getTeam,
                   thin wrapper over map/resources/get + event bus subscribe
  spawn.ts       — encode/decode for MAP task meta
```

Everything in `src/sync/` is either a pure function or accepts an existing MAP server/client by reference. No transport in the package itself.

### How a hub integrates

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk";
import {
  wireOpenTeamsHandlers,
  createLoadoutKindHandler,
  createTeamKindHandler,
  InMemoryBundleStore,
} from "@openteams/sync";

const server = new MAPServer({ /* ... */ });
const store = new InMemoryBundleStore();    // or your own backend

const unwire = wireOpenTeamsHandlers(server, [
  createLoadoutKindHandler({ store }),
  createTeamKindHandler({ store }),
]);
```

`wireOpenTeamsHandlers` does four things:

1. Installs `map/resources/list` and `map/resources/get` as additional handlers if not already present. If they exist (another kind package wired itself first), it **wraps** the existing handler: requests for `x-openteams/*` types route to OpenTeams handlers, others fall through.
2. Installs `x-openteams/loadout/publish` and `x-openteams/team/publish` as additional handlers.
3. Adds `x-openteams/loadout` and `x-openteams/team` to `capabilities.resources.kinds`.
4. Returns `unwire()` which removes everything.

### How an agent fetches

```typescript
import { OpenTeamsClient } from "@openteams/sync";

const client = new OpenTeamsClient(mapClient);
const loadout  = await client.getLoadout("sha256:abc");      // → ResolvedLoadout
const template = await client.getTeam("sha256:9f3a");        // → ResolvedTemplate

const unsub = client.onBundleEvent((evt) => {
  if (evt.resource_type === "x-openteams/loadout" && evt.type === "resource.updated") {
    // …
  }
});
```

`OpenTeamsClient` is ~50 lines: `getLoadout` calls `map/resources/get { type, id }` and hydrates the result; `onBundleEvent` subscribes to the SDK's existing event bus and filters client-side.

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
