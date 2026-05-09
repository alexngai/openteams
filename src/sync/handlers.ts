// ─────────────────────────────────────────────────────────────
// Resource kind handler factories + compose helper
// ─────────────────────────────────────────────────────────────
// What OpenTeams hands a hub: per-kind handlers and a method-name
// map ready for the MAP SDK's `additionalHandlers` slot. The hub
// stays in control of storage and access policy by passing a
// `BundleStore` of its choice.
//
// See docs/map-integration.md for the full integration narrative.

import { verifyHash } from "./bundle";
import { validateTeamBundle } from "./validate";
import {
  LOADOUT_RESOURCE_TYPE,
  TEAM_RESOURCE_TYPE,
  type BundleStore,
  type ComposedResourceHandlers,
  type ListResourcesParams,
  type LoadoutResource,
  type MAPResource,
  type ResourceHandlerContext,
  type ResourceKindHandler,
  type ResourceMethodHandler,
  type TeamResource,
} from "./types";

interface CreateKindHandlerOptions {
  store: BundleStore;
  /**
   * Hook to override `created_at` / `updated_at` stamping on publish.
   * Defaults to `new Date().toISOString()`.
   */
  now?: () => string;
}

/**
 * Build a handler for the `x-openteams/loadout` kind. `list` and
 * `get` delegate to the store. `publish` verifies the bundle hash,
 * stamps `updated_at` (and `created_at` for first-time publishes),
 * and persists.
 */
export function createLoadoutKindHandler(
  opts: CreateKindHandlerOptions
): ResourceKindHandler {
  const now = opts.now ?? defaultNow;

  return {
    type: LOADOUT_RESOURCE_TYPE,

    async list(params, _ctx) {
      return opts.store.list(LOADOUT_RESOURCE_TYPE, params);
    },

    async get(id, _ctx) {
      return opts.store.get(LOADOUT_RESOURCE_TYPE, id);
    },

    async publish(bundle, _ctx) {
      assertResourceType(bundle, LOADOUT_RESOURCE_TYPE);
      if (!verifyHash(bundle as unknown as LoadoutResource)) {
        throw new ResourcePublishError(
          `Hash mismatch: ${bundle.id} does not match content`
        );
      }
      const stored = await stampAndPut(opts.store, bundle, now);
      return stored;
    },
  };
}

/** Build a handler for the `x-openteams/team` kind. */
export function createTeamKindHandler(
  opts: CreateKindHandlerOptions
): ResourceKindHandler {
  const now = opts.now ?? defaultNow;

  return {
    type: TEAM_RESOURCE_TYPE,

    async list(params, _ctx) {
      return opts.store.list(TEAM_RESOURCE_TYPE, params);
    },

    async get(id, _ctx) {
      return opts.store.get(TEAM_RESOURCE_TYPE, id);
    },

    async publish(bundle, _ctx) {
      assertResourceType(bundle, TEAM_RESOURCE_TYPE);
      // Deeper check than team-hash alone: also catches tampering of embedded
      // loadouts whose ids the publisher left intact. validateTeamBundle
      // surfaces both team-level and embedded-level hash mismatches as
      // error-severity violations.
      const validation = validateTeamBundle(bundle as unknown as TeamResource);
      const error = validation.violations.find((v) => v.severity === "error");
      if (error) {
        throw new ResourcePublishError(error.message);
      }
      const stored = await stampAndPut(opts.store, bundle, now);
      return stored;
    },
  };
}

/**
 * Compose a set of kind handlers into a method-handler map suitable for
 * `MAPServer.additionalHandlers`, plus the `kinds` list to pass to
 * `capabilities.resources.kinds`. Pure function — no mutation.
 *
 *   const { handlers, kinds } = composeResourceHandlers([
 *     createLoadoutKindHandler({ store }),
 *     createTeamKindHandler({ store }),
 *   ]);
 *   const server = new MAPServer({
 *     resources: { enabled: true, kinds },
 *     additionalHandlers: handlers,
 *   });
 */
export function composeResourceHandlers(
  handlers: ResourceKindHandler[]
): ComposedResourceHandlers {
  const byType = new Map<string, ResourceKindHandler>();
  for (const h of handlers) {
    if (byType.has(h.type)) {
      throw new Error(`Duplicate handler registered for type: ${h.type}`);
    }
    byType.set(h.type, h);
  }

  const methodHandlers: Record<string, ResourceMethodHandler> = {
    "map/resources/list": async (params, ctx) => {
      const p = asListParams(params);
      const handler = handlerFor(byType, p.type);
      return handler.list(
        { filter: p.filter, cursor: p.cursor, limit: p.limit },
        ctx
      );
    },
    "map/resources/get": async (params, ctx) => {
      const p = asGetParams(params);
      const handler = handlerFor(byType, p.type);
      const resource = await handler.get(p.id, ctx);
      if (!resource) {
        throw new ResourceNotFoundError(`Not found: ${p.type} ${p.id}`);
      }
      return resource;
    },
  };

  // Per-kind publish methods: <type>/publish
  for (const handler of handlers) {
    if (handler.publish) {
      const publishImpl = handler.publish.bind(handler);
      methodHandlers[`${handler.type}/publish`] = async (params, ctx) => {
        const p = asPublishParams(params);
        return publishImpl(p.bundle, ctx);
      };
    }
  }

  return {
    handlers: methodHandlers,
    kinds: handlers.map((h) => h.type),
  };
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

export class ResourceNotFoundError extends Error {
  /** MAP error code -32004. */
  readonly code = -32004;
  constructor(message: string) {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

export class UnknownResourceTypeError extends Error {
  /** MAP error code -32001. */
  readonly code = -32001;
  constructor(message: string) {
    super(message);
    this.name = "UnknownResourceTypeError";
  }
}

export class ResourcePublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourcePublishError";
  }
}

// ─────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────

function defaultNow(): string {
  return new Date().toISOString();
}

async function stampAndPut(
  store: BundleStore,
  bundle: MAPResource,
  now: () => string
): Promise<MAPResource> {
  const existing = await store.get(bundle.type, bundle.id);
  const ts = now();
  const stamped: MAPResource = {
    ...bundle,
    created_at: existing ? existing.created_at : bundle.created_at || ts,
    updated_at: ts,
  };
  return store.put(stamped);
}

function assertResourceType(bundle: MAPResource, expected: string): void {
  if (!bundle || typeof bundle !== "object") {
    throw new ResourcePublishError("Bundle is not an object");
  }
  if (bundle.type !== expected) {
    throw new ResourcePublishError(
      `Expected resource type ${expected}, got ${String(bundle.type)}`
    );
  }
}

function handlerFor(
  byType: Map<string, ResourceKindHandler>,
  type: string
): ResourceKindHandler {
  const handler = byType.get(type);
  if (!handler) {
    throw new UnknownResourceTypeError(
      `No handler registered for resource type: ${type}`
    );
  }
  return handler;
}

function asListParams(
  params: unknown
): { type: string } & ListResourcesParams {
  if (!isObject(params) || typeof params.type !== "string") {
    throw new Error("map/resources/list requires { type: string }");
  }
  return {
    type: params.type,
    filter: isObject(params.filter) ? params.filter : undefined,
    cursor: typeof params.cursor === "string" ? params.cursor : undefined,
    limit: typeof params.limit === "number" ? params.limit : undefined,
  };
}

function asGetParams(params: unknown): { type: string; id: string } {
  if (!isObject(params) || typeof params.type !== "string" || typeof params.id !== "string") {
    throw new Error("map/resources/get requires { type: string, id: string }");
  }
  return { type: params.type, id: params.id };
}

function asPublishParams(params: unknown): { bundle: MAPResource } {
  if (!isObject(params) || !isObject(params.bundle)) {
    throw new Error("publish requires { bundle: MAPResource }");
  }
  return { bundle: params.bundle as unknown as MAPResource };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
