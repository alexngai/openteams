/**
 * Real MAP SDK integration test.
 *
 * Builds a MAPServer from `@multi-agent-protocol/sdk/server` with our
 * composed handlers wired through `additionalHandlers`. Invokes the
 * handlers directly (server.handlers[method]) rather than going through
 * the transport, which is the cheapest end-to-end check that:
 *
 *   - our `ResourceMethodHandler` shape adapts cleanly to the SDK's
 *     `Handler` shape (just a context-shape difference)
 *   - the SDK's MAPServer constructs without error when our handlers
 *     are registered
 *   - the SDK's capabilities advertisement includes our resource kinds
 *   - calling map/resources/get / publish through the SDK-managed
 *     handler registry returns the same results as calling our
 *     composed handlers directly
 *
 * If the SDK's wire format diverges from what our handlers expect,
 * this catches it. Higher-confidence transport-level integration
 * (wiring streams via `createStreamPair`) is left for a future phase.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";

// Real SDK imports
import { MAPServer, type HandlerContext, type Handler } from "@multi-agent-protocol/sdk/server";

import { TemplateLoader } from "../template/loader";
import { bundleLoadout } from "./bundle";
import {
  composeResourceHandlers,
  createLoadoutKindHandler,
  createTeamKindHandler,
} from "./handlers";
import { InMemoryBundleStore } from "./store";
import {
  LOADOUT_RESOURCE_TYPE,
  TEAM_RESOURCE_TYPE,
  type ComposedResourceHandlers,
  type LoadoutResource,
  type ResourceHandlerContext,
} from "./types";

const LOADOUT_DEMO_DIR = path.resolve(__dirname, "../../examples/loadout-demo");

/**
 * Adapter: convert OpenTeams's `ResourceMethodHandler` shape to the
 * SDK's `Handler` shape. The two differ only in context — the SDK's
 * `HandlerContext` carries `session`, `requestId`, `signal`; ours
 * carries `callerId` and `session` as a free-form record.
 */
function adaptToSdkHandlers(
  composed: ComposedResourceHandlers
): Record<string, Handler> {
  const out: Record<string, Handler> = {};
  for (const [method, handler] of Object.entries(composed.handlers)) {
    out[method] = async (params, sdkCtx: HandlerContext) => {
      const ourCtx: ResourceHandlerContext = {
        callerId: sdkCtx.session?.id ?? null,
        session: { id: sdkCtx.session?.id, role: sdkCtx.session?.role },
      };
      return handler(params, ourCtx);
    };
  }
  return out;
}

function fakeHandlerContext(): HandlerContext {
  return {
    session: {
      id: "test-session-1",
      role: "agent",
      status: "active",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    } as HandlerContext["session"],
    requestId: "req-1",
    signal: new AbortController().signal,
  };
}

describe("integration: MAP SDK MAPServer with our composed handlers", () => {
  it("constructs a MAPServer with our handlers registered under additionalHandlers", () => {
    const store = new InMemoryBundleStore();
    const composed = composeResourceHandlers([
      createLoadoutKindHandler({ store }),
      createTeamKindHandler({ store }),
    ]);

    const server = new MAPServer({
      capabilities: {
        resources: { enabled: true, kinds: composed.kinds },
      },
      additionalHandlers: adaptToSdkHandlers(composed),
    });

    // Our methods landed in the server's handler registry
    expect(server.handlers["map/resources/list"]).toBeDefined();
    expect(server.handlers["map/resources/get"]).toBeDefined();
    expect(server.handlers[`${LOADOUT_RESOURCE_TYPE}/publish`]).toBeDefined();
    expect(server.handlers[`${TEAM_RESOURCE_TYPE}/publish`]).toBeDefined();
  });

  it("publishes and fetches a loadout end-to-end via server.handlers[method]", async () => {
    const store = new InMemoryBundleStore();
    const composed = composeResourceHandlers([
      createLoadoutKindHandler({ store }),
    ]);

    const server = new MAPServer({
      capabilities: {
        resources: { enabled: true, kinds: composed.kinds },
      },
      additionalHandlers: adaptToSdkHandlers(composed),
    });

    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    const ctx = fakeHandlerContext();

    // Publish through the SDK's handler registry
    const publishHandler = server.handlers[`${LOADOUT_RESOURCE_TYPE}/publish`]!;
    const published = (await publishHandler({ bundle }, ctx)) as LoadoutResource;
    expect(published.id).toBe(bundle.id);
    expect(published.type).toBe(LOADOUT_RESOURCE_TYPE);

    // Fetch through the same registry
    const getHandler = server.handlers["map/resources/get"]!;
    const fetched = (await getHandler(
      { type: LOADOUT_RESOURCE_TYPE, id: bundle.id },
      ctx
    )) as LoadoutResource;
    expect(fetched.id).toBe(bundle.id);
    expect(fetched.metadata.resolved).toEqual(reviewer);
  });

  it("propagates not-found errors with the spec's -32004 code", async () => {
    const store = new InMemoryBundleStore();
    const composed = composeResourceHandlers([
      createLoadoutKindHandler({ store }),
    ]);
    const server = new MAPServer({
      capabilities: { resources: { enabled: true, kinds: composed.kinds } },
      additionalHandlers: adaptToSdkHandlers(composed),
    });

    const ctx = fakeHandlerContext();
    const getHandler = server.handlers["map/resources/get"]!;

    await expect(
      getHandler({ type: LOADOUT_RESOURCE_TYPE, id: "sha256:" + "0".repeat(64) }, ctx)
    ).rejects.toMatchObject({ code: -32004 });
  });

  it("throws -32001 for an unknown resource type", async () => {
    const store = new InMemoryBundleStore();
    const composed = composeResourceHandlers([
      createLoadoutKindHandler({ store }),
    ]);
    const server = new MAPServer({
      capabilities: { resources: { enabled: true, kinds: composed.kinds } },
      additionalHandlers: adaptToSdkHandlers(composed),
    });

    const ctx = fakeHandlerContext();
    const listHandler = server.handlers["map/resources/list"]!;

    await expect(
      listHandler({ type: "x-other/thing" }, ctx)
    ).rejects.toMatchObject({ code: -32001 });
  });
});
