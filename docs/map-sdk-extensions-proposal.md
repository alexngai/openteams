# MAP SDK Extensions Proposal — Resource Protocol Implementation

> Status: **Draft proposal** — written from OpenTeams's perspective for the [MAP SDK](https://github.com/alexngai/multi-agent-protocol). Intended to seed a discussion and ultimately become a PR against `multi-agent-protocol/ts-sdk/`.

## Summary

The [MAP Resource Protocol v1](https://github.com/alexngai/multi-agent-protocol/blob/main/docs/13-resource-protocol.md) defines an envelope (`MAPResource`), two read methods (`map/resources/list`, `map/resources/get`), a kind handler dispatch convention, capability advertisement, and an optional event contract. The SDK currently ships:

- ✅ Method registration in `ts-sdk/src/protocol/index.ts:439-450`
- ✅ Capability advertisement (`ParticipantCapabilities.resources`) in `ts-sdk/src/types/index.ts:303-309`
- ✅ Generic `additionalHandlers` mechanism on `MAPServer` (`ts-sdk/src/server/CLAUDE.md:196-209`)

But not:

- ❌ The `MAPResource` and `ResourceKindHandler` TypeScript interfaces
- ❌ Built-in dispatch from `map/resources/list/get` to per-kind handlers (every hub writes the dispatch logic itself)
- ❌ Resource lifecycle events (`resource.added/updated/removed`)
- ❌ `resources:<type>` scope channel routing for those events

This proposal adds those four pieces. All changes are **additive and non-breaking** — hubs already using `additionalHandlers['map/resources/list']` keep working unchanged; the new APIs are an opt-in higher-level abstraction.

The motivation is concrete: OpenTeams (and any other kind package — opentasks, minimem, skill-tree, etc.) needs to plug typed kind handlers into a MAP server without reimplementing dispatch and event emission for each kind. Today every package has to roll its own; after these changes, kind packages export factories and hubs register them.

## Proposed additions

### 1. Ship the protocol types

**File:** `ts-sdk/src/types/index.ts` (add to existing file)

```typescript
// =============================================================================
// Resource Protocol Types (MAP Resource Protocol v1)
// =============================================================================

/** Standard envelope for any typed resource on the wire. */
export interface MAPResource {
  /** Kind-defined unique id. */
  id: string;
  /** Namespaced type, e.g., "x-workspace/repo", "x-openteams/loadout". */
  type: string;
  /** Human-readable display name. Not necessarily unique. */
  name: string;
  /** Lifecycle status. Values are kind-defined. */
  status: string;
  /** Owning agent/user id. */
  owner_id: string;
  /** null for locally-created; the originating hub id for federated resources. */
  origin_hub_id: string | null;
  /** ISO-8601 creation timestamp. */
  created_at: string;
  /** ISO-8601 last-modification timestamp. */
  updated_at: string;
  /** Kind-specific payload. Opaque to the protocol. */
  metadata: Record<string, unknown>;
  _meta?: Meta;
}

/** Per-kind handler registered with the server. */
export interface ResourceKindHandler {
  /** The namespaced type this handler serves. */
  type: string;

  list(
    params: {
      filter?: Record<string, unknown>;
      cursor?: string | null;
      limit?: number;
    },
    ctx: ResourceHandlerContext
  ): Promise<{
    resources: MAPResource[];
    cursor?: string | null;
    total?: number;
  }>;

  get(id: string, ctx: ResourceHandlerContext): Promise<MAPResource | null>;
}

/** Context passed to resource kind handlers. Mirrors the MAPContext shape from the spec. */
export interface ResourceHandlerContext {
  /** Authenticated caller identity. null if unauthenticated. */
  callerId: string | null;
  /** Hub-specific session metadata. */
  session: Record<string, unknown>;
}

/** Resource lifecycle event payload (matches event contract in spec section "Events"). */
export interface ResourceEvent {
  type: "resource.added" | "resource.updated" | "resource.removed";
  resource_type: string;
  resource_id: string;
  resource_name: string;
  origin_hub_id: string | null;
  timestamp: string;
}
```

**Rationale:** these are the protocol's own types. Codifying them prevents drift between kind packages and gives the SDK a place to attach dispatch + event helpers.

### 2. Built-in handler dispatch on `MAPServer`

**Files:**
- `ts-sdk/src/server/server.ts` — add `registerResourceKind(handler)` and a default dispatcher
- `ts-sdk/src/server/router/handlers.ts` — wire the dispatcher into the router

**API:**

```typescript
class MAPServer {
  // existing fields...
  private resourceKindHandlers = new Map<string, ResourceKindHandler>();

  /**
   * Register a handler for a resource kind. The SDK auto-wires
   * map/resources/list and map/resources/get to dispatch by type.
   *
   * If a handler is already registered for this type, throws.
   */
  registerResourceKind(handler: ResourceKindHandler): void {
    if (this.resourceKindHandlers.has(handler.type)) {
      throw new Error(`Resource kind handler already registered: ${handler.type}`);
    }
    this.resourceKindHandlers.set(handler.type, handler);
    this.refreshResourceCapabilities();
  }

  /** Convenience for batch registration. */
  registerResourceKinds(handlers: ResourceKindHandler[]): void {
    handlers.forEach((h) => this.registerResourceKind(h));
  }

  private refreshResourceCapabilities(): void {
    // Update capabilities.resources.kinds = [...registered types]
  }
}
```

The router gains a default dispatcher (only installed if at least one kind is registered):

```typescript
"map/resources/list": async (params, ctx) => {
  const handler = server.resourceKindHandlers.get(params.type);
  if (!handler) throw mapError(-32001, `unknown_resource_type: ${params.type}`);
  return handler.list(
    { filter: params.filter, cursor: params.cursor, limit: params.limit },
    toResourceContext(ctx)
  );
}

"map/resources/get": async (params, ctx) => {
  const handler = server.resourceKindHandlers.get(params.type);
  if (!handler) throw mapError(-32001, `unknown_resource_type: ${params.type}`);
  const result = await handler.get(params.id, toResourceContext(ctx));
  if (!result) throw mapError(-32004, "not_found");
  return result;
}
```

**Backwards compatibility:** if a hub provides `additionalHandlers['map/resources/list']` (existing pattern), that takes precedence. The default dispatcher only installs when no override exists. This lets current hubs migrate at their own pace.

**Rationale:** every kind package shouldn't have to write the same dispatch logic. The SDK already has the method registry and capability advertisement; this closes the loop.

### 3. Resource event emission helpers

**File:** `ts-sdk/src/server/server.ts` (add to `MAPServer`)

```typescript
class MAPServer {
  /**
   * Emit a resource lifecycle event on the appropriate scope channel.
   * Routes to subscribers of resources:<type>, resources:<namespace>/*, and resources:*.
   */
  emitResourceEvent(
    kind: "added" | "updated" | "removed",
    resource: Pick<MAPResource, "id" | "type" | "name" | "origin_hub_id">
  ): void {
    const event: ResourceEvent = {
      type: `resource.${kind}` as ResourceEvent["type"],
      resource_type: resource.type,
      resource_id: resource.id,
      resource_name: resource.name,
      origin_hub_id: resource.origin_hub_id ?? null,
      timestamp: new Date().toISOString(),
    };

    // Emit on the event bus with scope channel addressing
    this.eventBus.emit({
      type: event.type,
      data: event,
      source: { /* server identity */ },
      // Scope channel matching is below
    });
  }
}
```

**File:** `ts-sdk/src/server/scopes/index.ts` or `ts-sdk/src/server/subscriptions/`

Add scope channel patterns for resources:

```typescript
// Subscribers can subscribe to:
//   resources:x-openteams/loadout       — exact type
//   resources:x-openteams/*             — namespace wildcard
//   resources:*                         — all resource events
```

The matching logic plugs into the existing subscription mechanism (`server/subscriptions/`) — resources:* channels are just another addressable scope, parallel to the existing scope channels for tasks/agents.

**Rationale:** the spec already calls these out (`docs/13-resource-protocol.md` § Events). Hubs can implement event emission today by hand-rolling against the event bus, but every kind package will write the same code. Surfacing it on `MAPServer` with a typed helper standardizes it.

### 4. Document the kind-specific publish convention

**File:** `docs/13-resource-protocol.md` (add new section)

```markdown
## Writes (kind-specific)

The Resource Protocol does not define generic write operations; writes are
kind-specific. Kinds that support publishing/mutation SHOULD register
additional methods with their type prefix:

  <type>/publish      — create a new resource of this kind
  <type>/update       — update an existing resource
  <type>/remove       — archive or delete a resource

Example (OpenTeams loadouts):

  x-openteams/loadout/publish    →  creates an x-openteams/loadout resource

These methods are registered as `additionalHandlers` on the MAP server and
emit `resource.added` / `resource.updated` / `resource.removed` events on
their type's scope channel.
```

**Rationale:** there's no protocol code to write, just convention. But documenting it prevents fragmentation across kind packages (one uses `<kind>/create`, another uses `<kind>/save`, etc.).

## Migration path

Hubs already implementing the Resource Protocol manually via `additionalHandlers`:

1. Continue working unchanged. The default dispatcher only installs if no override exists.
2. Optional migration: replace per-kind logic in `additionalHandlers['map/resources/list']` with `server.registerResourceKind(handler)` calls. The SDK takes over dispatch.
3. Replace ad-hoc event emission with `server.emitResourceEvent()` calls.

No flag day. Both styles coexist.

## Test plan

- **Type contracts:** TypeScript compilation tests confirm `MAPResource`, `ResourceKindHandler`, etc., match the spec.
- **Dispatch:** integration test with two registered kinds, verifying `map/resources/list { type }` and `map/resources/get { type, id }` route to the correct handler. Test `-32001` for unknown type, `-32004` for not-found.
- **Capability advertisement:** confirm `capabilities.resources.kinds[]` reflects registered handlers.
- **Events:** integration test that `emitResourceEvent` reaches subscribers on `resources:<type>`, `resources:<namespace>/*`, and `resources:*` channels.
- **Backwards compat:** test that `additionalHandlers['map/resources/list']` still works and overrides the default dispatcher.

## Out of scope (for this proposal)

- **Generic write methods.** `map/resources/create/update/delete` is a future proposal once we see whether kind-specific writes (`<kind>/publish`) are sufficient in practice. Punting now keeps this PR focused.
- **Federation.** The `origin_hub_id` field already exists in the envelope; federation pipelines build on top of the spec but aren't part of these SDK additions.
- **Access control.** Per the spec: "implementation-defined." Kind handlers and their context (`ResourceHandlerContext`) are the extension point; the SDK doesn't impose a model.
- **REST/UI enrichment.** Hub concern, not SDK.

## Why this is the right scope

The Resource Protocol spec is already strong — what's missing is implementation surface. Each of the four additions corresponds to a specific spec section (envelope, dispatch, capabilities, events). Shipping them in the SDK:

- Removes per-kind boilerplate. Kind packages export factories; hubs register them.
- Standardizes event routing. Today there's no canonical way to subscribe to "all loadout updates" — every hub can choose their own scope channel naming. The SDK provides the convention.
- Keeps the SDK opt-in. Hubs that don't use the Resource Protocol see zero behavior change.

The smallest version of this proposal that unblocks OpenTeams is just **(1) types** and **(2) dispatch** — events can come later if needed. But emitting events is also tiny once the types are in place, so all four hang together as one PR.
