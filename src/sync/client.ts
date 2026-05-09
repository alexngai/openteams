// ─────────────────────────────────────────────────────────────
// OpenTeamsClient — typed wrapper interface
// ─────────────────────────────────────────────────────────────
// OpenTeams ships the interface; consumers ship the radio. An
// implementation typically wraps a MAP SDK client by translating
// `getLoadout` → `map/resources/get { type: "x-openteams/loadout", id }`
// and similarly for the other methods.
//
// The interface is deliberately minimal: most agents only use
// `getLoadout`. Coordinators add `getTeam`. Publishers add
// `publish*`. Observers add `onBundleEvent`. Capabilities are
// advertised by which methods are implemented.
//
// See docs/map-integration.md for the wiring path.

import { parseRef } from "./uri";
import {
  LOADOUT_RESOURCE_TYPE,
  TEAM_RESOURCE_TYPE,
  type BundleEvent,
  type LoadoutResource,
  type OpenTeamsResourceType,
  type SpawnRequest,
  type SpawnResult,
  type TeamResource,
} from "./types";

export interface OpenTeamsClient {
  /**
   * Fetch a loadout resource. Accepts either a stringified resource
   * reference (`x-openteams/loadout:sha256:…`) or a bare id
   * (`sha256:…` / `<name>@<version>`).
   */
  getLoadout(idOrRef: string): Promise<LoadoutResource>;

  /** Fetch a team resource. Same id-or-ref accepting form as `getLoadout`. */
  getTeam?(idOrRef: string): Promise<TeamResource>;

  /** Publish a loadout bundle. Returns the persisted resource (with hub-assigned timestamps). */
  publishLoadout?(bundle: LoadoutResource): Promise<LoadoutResource>;

  /** Publish a team bundle. */
  publishTeam?(bundle: TeamResource): Promise<TeamResource>;

  /**
   * Subscribe to bundle lifecycle events (`resource.added`,
   * `resource.updated`, `resource.removed`) for OpenTeams resource
   * types. Returns an unsubscribe function.
   */
  onBundleEvent?(callback: (event: BundleEvent) => void): () => void;

  /** Dispatch a spawn request. Resolves when the resulting MAP task completes. */
  requestSpawn?(req: SpawnRequest): Promise<SpawnResult>;

  /**
   * Subscribe to spawn requests targeting this consumer. Worker pools
   * implement this to receive dispatch tasks. Returns an unsubscribe function.
   */
  onSpawnRequest?(callback: (req: SpawnRequest, taskId: string) => void): () => void;
}

// ─────────────────────────────────────────────────────────────
// Reference implementation backed by a minimal MAP-client surface
// ─────────────────────────────────────────────────────────────

/**
 * Minimum surface a MAP client must expose for OpenTeams to wrap it.
 * The actual MAP SDK's `MAPClient` satisfies this naturally — just
 * the methods OpenTeams calls.
 */
export interface MAPClientCallable {
  call<T>(method: string, params: unknown): Promise<T>;
}

export interface CreateOpenTeamsClientOptions {
  /**
   * Optional event subscription hook. If provided, `onBundleEvent`
   * is wired to it; otherwise the returned client omits the method.
   */
  onEvent?: (callback: (event: BundleEvent) => void) => () => void;
}

/**
 * Build an `OpenTeamsClient` that delegates to a MAP client. Methods
 * resolve `id-or-ref` arguments — callers can pass either a bare id
 * (`sha256:…` or `name@version`) or a full ref string
 * (`x-openteams/loadout:sha256:…`).
 */
export function createOpenTeamsClient(
  mapClient: MAPClientCallable,
  options: CreateOpenTeamsClientOptions = {}
): OpenTeamsClient {
  const client: OpenTeamsClient = {
    async getLoadout(idOrRef: string): Promise<LoadoutResource> {
      const { type, id } = resolveRefOrId(idOrRef, LOADOUT_RESOURCE_TYPE);
      return mapClient.call<LoadoutResource>("map/resources/get", { type, id });
    },

    async getTeam(idOrRef: string): Promise<TeamResource> {
      const { type, id } = resolveRefOrId(idOrRef, TEAM_RESOURCE_TYPE);
      return mapClient.call<TeamResource>("map/resources/get", { type, id });
    },

    async publishLoadout(bundle: LoadoutResource): Promise<LoadoutResource> {
      return mapClient.call<LoadoutResource>(`${LOADOUT_RESOURCE_TYPE}/publish`, {
        bundle,
      });
    },

    async publishTeam(bundle: TeamResource): Promise<TeamResource> {
      return mapClient.call<TeamResource>(`${TEAM_RESOURCE_TYPE}/publish`, {
        bundle,
      });
    },
  };

  if (options.onEvent) {
    const subscribe = options.onEvent;
    client.onBundleEvent = (callback) => subscribe(callback);
  }

  return client;
}

function resolveRefOrId(
  input: string,
  defaultType: OpenTeamsResourceType
): { type: OpenTeamsResourceType; id: string } {
  if (input.startsWith("x-openteams/")) {
    const ref = parseRef(input);
    if (ref) return ref;
    throw new Error(`Invalid resource reference: ${input}`);
  }
  return { type: defaultType, id: input };
}
