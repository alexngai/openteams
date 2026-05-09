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

import { randomUUID } from "node:crypto";

import { decodeSpawnTaskMeta, encodeSpawnTaskMeta } from "./spawn";
import { parseRef } from "./uri";
import {
  LOADOUT_RESOURCE_TYPE,
  TEAM_RESOURCE_TYPE,
  type BundleEvent,
  type BundleEventType,
  type LoadoutResource,
  type MAPEventSubscribable,
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

  /** Remove a loadout by id. Returns true if the resource existed and was removed. */
  removeLoadout?(idOrRef: string): Promise<boolean>;

  /** Remove a team by id. Returns true if the resource existed and was removed. */
  removeTeam?(idOrRef: string): Promise<boolean>;

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
   * Optional event subscription hook. When provided, the returned
   * client implements `onBundleEvent`, `onSpawnRequest`, and
   * `requestSpawn`'s completion-waiting behavior. Without it, those
   * methods are omitted (or `requestSpawn` resolves immediately
   * with the created task id).
   */
  events?: MAPEventSubscribable;
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

    async removeLoadout(idOrRef: string): Promise<boolean> {
      const { id } = resolveRefOrId(idOrRef, LOADOUT_RESOURCE_TYPE);
      const result = await mapClient.call<{ removed: boolean }>(
        `${LOADOUT_RESOURCE_TYPE}/remove`,
        { id }
      );
      return result.removed;
    },

    async removeTeam(idOrRef: string): Promise<boolean> {
      const { id } = resolveRefOrId(idOrRef, TEAM_RESOURCE_TYPE);
      const result = await mapClient.call<{ removed: boolean }>(
        `${TEAM_RESOURCE_TYPE}/remove`,
        { id }
      );
      return result.removed;
    },
  };

  // ── Spawn dispatch (orchestrator side) ───────────────────────
  // Generates the task id client-side so the completion listener can
  // filter on it *before* the task.create call's events fire. Without
  // this, a worker that flips status synchronously in one update call
  // can race ahead of the listener registration.
  //
  // **Portability assumption:** the underlying MAP server must honor
  // the client-supplied task id. The MAP spec
  // (`TasksCreateRequestParams.task.id?: TaskId`) permits this, but
  // a server that auto-reassigns ids on create would break the
  // completion correlation here. If you're targeting such a server,
  // wrap this client and look up the assigned id from the create
  // response, then track completion via that id instead.
  client.requestSpawn = async (req: SpawnRequest): Promise<SpawnResult> => {
    const taskId = `spawn-${randomUUID()}`;

    if (!options.events) {
      // No subscription: caller has to track completion themselves.
      await mapClient.call("map/tasks/create", {
        task: { id: taskId, status: "open", meta: encodeSpawnTaskMeta(req) },
      });
      return { taskId, status: "open" };
    }

    const subscribable = options.events;
    const completion = new Promise<SpawnResult>((resolve) => {
      const unsub = subscribable.on((event) => {
        const data = event.data as
          | { taskId?: string; current?: string; task?: { meta?: { agentId?: string } } }
          | undefined;
        if (event.type === "task.completed" && data?.taskId === taskId) {
          unsub();
          resolve({
            taskId,
            status: "completed",
            agentId: data.task?.meta?.agentId,
          });
        } else if (
          event.type === "task.status" &&
          data?.taskId === taskId &&
          (data.current === "failed" || data.current === "cancelled")
        ) {
          unsub();
          resolve({ taskId, status: data.current });
        }
      });
    });

    await mapClient.call("map/tasks/create", {
      task: { id: taskId, status: "open", meta: encodeSpawnTaskMeta(req) },
    });
    return completion;
  };

  if (options.events) {
    const subscribable = options.events;

    // ── Bundle lifecycle subscription ───────────────────────
    client.onBundleEvent = (callback) =>
      subscribable.on((event) => {
        if (!isBundleEventType(event.type)) return;
        const data = event.data as Partial<BundleEvent> | undefined;
        if (!data?.resource_type || !data.resource_id) return;
        if (
          data.resource_type !== LOADOUT_RESOURCE_TYPE &&
          data.resource_type !== TEAM_RESOURCE_TYPE
        ) {
          return;
        }
        callback({
          type: event.type as BundleEventType,
          resource_type: data.resource_type,
          resource_id: data.resource_id,
          resource_name: data.resource_name ?? "",
          origin_hub_id: data.origin_hub_id ?? null,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      });

    // ── Spawn dispatch (worker side) ───────────────────────
    client.onSpawnRequest = (callback) =>
      subscribable.on((event) => {
        if (event.type !== "task.created") return;
        const data = event.data as { task?: { id: string; meta?: unknown } } | undefined;
        if (!data?.task?.id) return;
        const decoded = decodeSpawnTaskMeta(data.task.meta);
        if (!decoded) return;
        callback(decoded, data.task.id);
      });
  }

  return client;
}

function isBundleEventType(type: string): type is BundleEventType {
  return (
    type === "resource.added" ||
    type === "resource.updated" ||
    type === "resource.removed"
  );
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
