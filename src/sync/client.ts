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

import type {
  BundleEvent,
  LoadoutResource,
  SpawnRequest,
  SpawnResult,
  TeamResource,
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
