/**
 * Full integration: publisher → mock MAP server → consumer.
 *
 * Exercises the wiring path described in docs/map-integration.md without
 * pulling in the real MAP SDK. The "server" is a ~30-line in-process
 * mock that holds the composed handler map and dispatches `call(method,
 * params)` to it; the client wraps it via `createOpenTeamsClient`.
 *
 * Catches things the e2e bundle tests can't: argument-shape mismatches
 * across the call boundary, error code propagation, fetch-by-id round
 * trips that go through the actual handler dispatch.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";

import { TemplateLoader } from "../template/loader";
import { bundleLoadout, bundleTeam, hydrateBundle, hydrateLoadout } from "./bundle";
import { createOpenTeamsClient, type MAPClientCallable } from "./client";
import {
  composeResourceHandlers,
  createLoadoutKindHandler,
  createTeamKindHandler,
} from "./handlers";
import { InMemoryBundleStore } from "./store";
import { loadoutRef } from "./uri";
import {
  LOADOUT_RESOURCE_TYPE,
  SPAWN_KIND,
  TEAM_RESOURCE_TYPE,
  type BundleEvent,
  type ComposedResourceHandlers,
  type MAPEvent,
  type MAPEventSubscribable,
  type MAPTaskShape,
  type ResourceHandlerContext,
  type SpawnRequest,
} from "./types";

const LOADOUT_DEMO_DIR = path.resolve(__dirname, "../../examples/loadout-demo");

/**
 * Tiny stand-in for a MAP server: holds a composed handler map, an
 * event bus, and a task store. Mirrors the surface of an SDK-backed
 * `MAPServer` for the methods OpenTeams uses.
 */
class MockMAPServer implements MAPEventSubscribable {
  private composed: ComposedResourceHandlers;
  private tasks = new Map<string, MAPTaskShape>();
  private nextTaskId = 1;
  private listeners = new Set<(event: MAPEvent) => void>();
  capabilities: { resources: { enabled: boolean; kinds: string[] } };

  constructor(composed: ComposedResourceHandlers) {
    this.composed = composed;
    this.capabilities = { resources: { enabled: true, kinds: composed.kinds } };
  }

  /** Emit a MAP event to every active subscriber. */
  emit(event: MAPEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Subscribe to events (matches `MAPEventSubscribable`). */
  on(callback: (event: MAPEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async call<T>(method: string, params: unknown, ctx?: Partial<ResourceHandlerContext>): Promise<T> {
    if (method === "map/tasks/create") return this.createTask(params) as T;
    if (method === "map/tasks/update") return this.updateTask(params) as T;

    const handler = this.composed.handlers[method];
    if (!handler) throw new Error(`No handler for method: ${method}`);
    const fullCtx: ResourceHandlerContext = {
      callerId: ctx?.callerId ?? null,
      session: ctx?.session ?? {},
    };
    return handler(params, fullCtx) as Promise<T>;
  }

  private createTask(params: unknown): { task: MAPTaskShape } {
    const p = params as { task?: Partial<MAPTaskShape> };
    const id = p.task?.id ?? `task-${this.nextTaskId++}`;
    const task: MAPTaskShape = {
      ...(p.task ?? {}),
      id,
      status: p.task?.status ?? "open",
    };
    this.tasks.set(id, task);
    this.emit({ type: "task.created", data: { task } });
    return { task };
  }

  private updateTask(params: unknown): { task: MAPTaskShape } {
    const p = params as { taskId: string; status?: string; meta?: unknown };
    const task = this.tasks.get(p.taskId);
    if (!task) throw new Error(`task not found: ${p.taskId}`);
    const previous = task.status;
    const updated: MAPTaskShape = {
      ...task,
      status: p.status ?? task.status,
      meta: p.meta !== undefined ? p.meta : task.meta,
    };
    this.tasks.set(task.id, updated);

    if (p.status && p.status !== previous) {
      this.emit({
        type: "task.status",
        data: { taskId: task.id, previous, current: updated.status },
      });
    }
    if (updated.status === "completed") {
      this.emit({ type: "task.completed", data: { taskId: task.id, task: updated } });
    }
    return { task: updated };
  }
}

function makeServerAndClient(): {
  store: InMemoryBundleStore;
  server: MockMAPServer;
  client: ReturnType<typeof createOpenTeamsClient>;
} {
  const store = new InMemoryBundleStore();
  // Forward emitted bundle events into the server's bus
  let server: MockMAPServer;
  const emit = (e: BundleEvent) => server.emit({ type: e.type, data: e });
  const composed = composeResourceHandlers([
    createLoadoutKindHandler({ store, emit }),
    createTeamKindHandler({ store, emit }),
  ]);
  server = new MockMAPServer(composed);

  const mapClient: MAPClientCallable = {
    call<T>(method: string, params: unknown) {
      return server.call<T>(method, params);
    },
  };

  return { store, server, client: createOpenTeamsClient(mapClient, { events: server }) };
}

describe("integration: publish → fetch (loadout)", () => {
  let setup: ReturnType<typeof makeServerAndClient>;

  beforeEach(() => {
    setup = makeServerAndClient();
  });

  it("publishes a loadout and fetches it back by id", async () => {
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    const published = await setup.client.publishLoadout!(bundle);
    expect(published.id).toBe(bundle.id);

    const fetched = await setup.client.getLoadout(bundle.id);
    expect(fetched.id).toBe(bundle.id);
    expect(hydrateLoadout(fetched)).toEqual(reviewer);
  });

  it("accepts both bare ids and full resource refs in getLoadout", async () => {
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });
    await setup.client.publishLoadout!(bundle);

    const fetchedBare = await setup.client.getLoadout(bundle.id);
    const fetchedRef = await setup.client.getLoadout(loadoutRef(bundle.id));
    expect(fetchedBare.id).toBe(bundle.id);
    expect(fetchedRef.id).toBe(bundle.id);
  });

  it("propagates the not-found error from the server", async () => {
    await expect(
      setup.client.getLoadout("sha256:" + "0".repeat(64))
    ).rejects.toThrow(/Not found/);
  });

  it("rejects publish of a hash-mismatched bundle", async () => {
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });
    const tampered = { ...bundle, id: "sha256:" + "f".repeat(64) };

    await expect(setup.client.publishLoadout!(tampered)).rejects.toThrow(/Hash mismatch/);
  });
});

describe("integration: publish → fetch (team)", () => {
  let setup: ReturnType<typeof makeServerAndClient>;

  beforeEach(() => {
    setup = makeServerAndClient();
  });

  it("publishes a team and hydrates it back", async () => {
    const template = TemplateLoader.load(LOADOUT_DEMO_DIR);
    const bundle = bundleTeam(template, { version: "1.0.0" });

    await setup.client.publishTeam!(bundle);
    const fetched = await setup.client.getTeam!(bundle.id);

    expect(fetched.id).toBe(bundle.id);
    const hydrated = hydrateBundle(fetched);
    expect(Array.from(hydrated.loadouts.keys())).toEqual(
      Array.from(template.loadouts.keys())
    );
  });

  it("advertises the registered kinds in capabilities", () => {
    expect(setup.server.capabilities.resources.enabled).toBe(true);
    expect(setup.server.capabilities.resources.kinds).toEqual(
      [LOADOUT_RESOURCE_TYPE, TEAM_RESOURCE_TYPE]
    );
  });
});

describe("integration: list", () => {
  it("returns all published loadouts of a type", async () => {
    const setup = makeServerAndClient();
    const template = TemplateLoader.load(LOADOUT_DEMO_DIR);

    for (const [name, resolved] of template.loadouts) {
      const bundle = bundleLoadout(resolved, { version: "1.0.0", name });
      await setup.client.publishLoadout!(bundle);
    }

    // Direct call via the underlying server (the OpenTeamsClient interface
    // doesn't expose list — it's a thin wrapper for fetches).
    const result = await setup.server.call<{ resources: { id: string }[] }>(
      "map/resources/list",
      { type: LOADOUT_RESOURCE_TYPE }
    );
    expect(result.resources.length).toBe(template.loadouts.size);
  });
});

describe("integration: end-to-end dispatch dry-run", () => {
  it("orchestrator publishes, dispatches a spawn task, worker resolves the loadout", async () => {
    const setup = makeServerAndClient();
    const template = TemplateLoader.load(LOADOUT_DEMO_DIR);
    const reviewer = template.loadouts.get("code-reviewer")!;

    // Orchestrator: publish the loadout the spawned agent will use
    const loadoutBundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });
    const published = await setup.client.publishLoadout!(loadoutBundle);

    // Worker (sharing the same MAP server): fetch the loadout by ref
    const ref = loadoutRef(published.id);
    const fetched = await setup.client.getLoadout(ref);
    const resolved = hydrateLoadout(fetched);

    expect(resolved).toEqual(reviewer);
    expect(resolved.capabilities).toContain("file.read");
  });
});

describe("integration: bundle event emission", () => {
  it("emits resource.added on first publish and resource.updated on republish", async () => {
    const setup = makeServerAndClient();
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    const events: BundleEvent[] = [];
    const unsub = setup.client.onBundleEvent!((e) => events.push(e));

    await setup.client.publishLoadout!(bundle);
    await setup.client.publishLoadout!(bundle); // republish

    unsub();

    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("resource.added");
    expect(events[0]!.resource_type).toBe(LOADOUT_RESOURCE_TYPE);
    expect(events[0]!.resource_id).toBe(bundle.id);
    expect(events[1]!.type).toBe("resource.updated");
  });

  it("filters events to OpenTeams resource types only", async () => {
    const setup = makeServerAndClient();
    const events: BundleEvent[] = [];
    const unsub = setup.client.onBundleEvent!((e) => events.push(e));

    // Inject a foreign resource event
    setup.server.emit({
      type: "resource.added",
      data: {
        resource_type: "x-other/thing",
        resource_id: "id-1",
        resource_name: "foreign",
        origin_hub_id: null,
        timestamp: "2026-05-09T00:00:00Z",
      },
    });

    unsub();
    expect(events).toHaveLength(0);
  });
});

describe("integration: spawn lifecycle (orchestrator + worker)", () => {
  it("orchestrator's requestSpawn resolves when worker completes the task", async () => {
    const setup = makeServerAndClient();
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });
    await setup.client.publishLoadout!(bundle);

    // Worker side: when a spawn task arrives, fetch the loadout, "boot" the
    // child, then mark the task completed with the agent id.
    const unsub = setup.client.onSpawnRequest!(async (req, taskId) => {
      const loadout = await setup.client.getLoadout(req.loadout);
      const childAgentId = `child-of-${req.label ?? "unknown"}`;
      // Update task: in_progress, then completed with agentId in meta.
      await setup.server.call("map/tasks/update", {
        taskId,
        status: "in_progress",
      });
      await setup.server.call("map/tasks/update", {
        taskId,
        status: "completed",
        meta: { ...(loadout.metadata ? {} : {}), kind: SPAWN_KIND, agentId: childAgentId },
      });
    });

    // Orchestrator side: dispatch and wait
    const req: SpawnRequest = {
      loadout: loadoutRef(bundle.id),
      label: "reviewer-1",
      role: "code-reviewer",
      target: { runtime: "claude-code" },
      parent: "orchestrator-1",
    };
    const result = await setup.client.requestSpawn!(req);

    unsub();

    expect(result.status).toBe("completed");
    expect(result.agentId).toBe("child-of-reviewer-1");
    expect(result.taskId).toMatch(/^spawn-/);
  });

  it("worker filters task.created events with non-spawn meta", async () => {
    const setup = makeServerAndClient();

    let spawnSeen = 0;
    const unsub = setup.client.onSpawnRequest!(() => spawnSeen++);

    // Inject a non-spawn task event directly
    setup.server.emit({
      type: "task.created",
      data: { task: { id: "non-spawn-1", status: "open", meta: { kind: "other.kind" } } },
    });

    unsub();
    expect(spawnSeen).toBe(0);
  });

  it("requestSpawn resolves with status=open when no events subscription is configured", async () => {
    const store = new InMemoryBundleStore();
    let server: MockMAPServer;
    const composed = composeResourceHandlers([
      createLoadoutKindHandler({ store }),
      createTeamKindHandler({ store }),
    ]);
    server = new MockMAPServer(composed);
    const mapClient: MAPClientCallable = {
      call<T>(method: string, params: unknown) {
        return server.call<T>(method, params);
      },
    };
    // Note: no `events` option
    const client = createOpenTeamsClient(mapClient);

    const result = await client.requestSpawn!({
      loadout: "x-openteams/loadout:sha256:abc",
    });
    expect(result.status).toBe("open");
    expect(result.taskId).toMatch(/^spawn-/);
  });

  it("orchestrator sees status=failed when worker marks task failed", async () => {
    const setup = makeServerAndClient();

    // Worker side: mark every spawn task as failed
    const unsub = setup.client.onSpawnRequest!(async (_req, taskId) => {
      await setup.server.call("map/tasks/update", { taskId, status: "failed" });
    });

    const result = await setup.client.requestSpawn!({
      loadout: "x-openteams/loadout:sha256:abc",
      label: "fail-me",
    });

    unsub();
    expect(result.status).toBe("failed");
    expect(result.agentId).toBeUndefined();
  });

  it("orchestrator sees status=cancelled when worker marks task cancelled", async () => {
    const setup = makeServerAndClient();

    const unsub = setup.client.onSpawnRequest!(async (_req, taskId) => {
      await setup.server.call("map/tasks/update", { taskId, status: "cancelled" });
    });

    const result = await setup.client.requestSpawn!({
      loadout: "x-openteams/loadout:sha256:abc",
      label: "cancel-me",
    });

    unsub();
    expect(result.status).toBe("cancelled");
  });
});

describe("integration: resource removal", () => {
  it("emits resource.removed and the resource is no longer fetchable", async () => {
    const setup = makeServerAndClient();
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    const events: BundleEvent[] = [];
    const unsub = setup.client.onBundleEvent!((e) => events.push(e));

    await setup.client.publishLoadout!(bundle);
    expect(events.at(-1)?.type).toBe("resource.added");

    const removed = await setup.client.removeLoadout!(bundle.id);
    expect(removed).toBe(true);
    expect(events.at(-1)?.type).toBe("resource.removed");
    expect(events.at(-1)?.resource_id).toBe(bundle.id);

    unsub();

    // Subsequent get should fail with not-found
    await expect(setup.client.getLoadout(bundle.id)).rejects.toThrow(/Not found/);
  });

  it("returns false for an unknown id and emits no event", async () => {
    const setup = makeServerAndClient();
    const events: BundleEvent[] = [];
    const unsub = setup.client.onBundleEvent!((e) => events.push(e));

    const removed = await setup.client.removeLoadout!("sha256:" + "0".repeat(64));
    expect(removed).toBe(false);
    expect(events).toHaveLength(0);

    unsub();
  });

  it("removeTeam works the same way as removeLoadout", async () => {
    const setup = makeServerAndClient();
    const template = TemplateLoader.load(LOADOUT_DEMO_DIR);
    const bundle = bundleTeam(template, { version: "1.0.0" });

    await setup.client.publishTeam!(bundle);
    expect(await setup.client.getTeam!(bundle.id)).toBeDefined();

    const removed = await setup.client.removeTeam!(bundle.id);
    expect(removed).toBe(true);

    await expect(setup.client.getTeam!(bundle.id)).rejects.toThrow(/Not found/);
  });

  it("accepts both bare ids and full resource refs", async () => {
    const setup = makeServerAndClient();
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    await setup.client.publishLoadout!(bundle);
    const removedByRef = await setup.client.removeLoadout!(loadoutRef(bundle.id));
    expect(removedByRef).toBe(true);
  });
});
