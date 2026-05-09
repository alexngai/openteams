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
  TEAM_RESOURCE_TYPE,
  type ComposedResourceHandlers,
  type ResourceHandlerContext,
} from "./types";

const LOADOUT_DEMO_DIR = path.resolve(__dirname, "../../examples/loadout-demo");

/**
 * Tiny stand-in for a MAP server: holds a composed handler map and
 * dispatches calls to it. Mirrors what an SDK-backed `MAPServer` does.
 */
class MockMAPServer {
  private composed: ComposedResourceHandlers;
  capabilities: { resources: { enabled: boolean; kinds: string[] } };

  constructor(composed: ComposedResourceHandlers) {
    this.composed = composed;
    this.capabilities = { resources: { enabled: true, kinds: composed.kinds } };
  }

  async call<T>(method: string, params: unknown, ctx?: Partial<ResourceHandlerContext>): Promise<T> {
    const handler = this.composed.handlers[method];
    if (!handler) throw new Error(`No handler for method: ${method}`);
    const fullCtx: ResourceHandlerContext = {
      callerId: ctx?.callerId ?? null,
      session: ctx?.session ?? {},
    };
    return handler(params, fullCtx) as Promise<T>;
  }
}

function makeServerAndClient(): {
  store: InMemoryBundleStore;
  server: MockMAPServer;
  client: ReturnType<typeof createOpenTeamsClient>;
} {
  const store = new InMemoryBundleStore();
  const composed = composeResourceHandlers([
    createLoadoutKindHandler({ store }),
    createTeamKindHandler({ store }),
  ]);
  const server = new MockMAPServer(composed);

  // Adapter: server.call → MAPClientCallable
  const mapClient: MAPClientCallable = {
    call<T>(method: string, params: unknown) {
      return server.call<T>(method, params);
    },
  };

  return { store, server, client: createOpenTeamsClient(mapClient) };
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
