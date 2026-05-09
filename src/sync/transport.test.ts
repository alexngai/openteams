/**
 * Transport-level integration test (Phase 9).
 *
 * Wires a full MAP request/response loop in-process via createStreamPair:
 *
 *     [client BaseConnection] ──stream──→ [MAPServer router]
 *                              ←──────────
 *
 * Sends real JSON-RPC requests over the stream — `map/connect` for the
 * handshake, then `x-openteams/loadout/publish` and `map/resources/get`
 * for our actual surface. Catches what previous phases couldn't:
 *
 *   - JSON-RPC envelope shape mismatches (request id, params, errors)
 *   - the SDK's connect handshake gating custom method calls
 *   - response correlation across the stream pair
 *   - that our handlers' return values survive the wire round-trip
 *
 * This test depends on @multi-agent-protocol/sdk's transport internals.
 * If the SDK changes its handshake or transport contract, this is the
 * test that breaks first — which is the value.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";

import {
  BaseConnection,
  MAPRequestError,
  PROTOCOL_VERSION,
  createStreamPair,
  type Stream,
} from "@multi-agent-protocol/sdk";
import {
  MAPServer,
  type Handler,
  type HandlerContext,
} from "@multi-agent-protocol/sdk/server";

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
  type ComposedResourceHandlers,
  type LoadoutResource,
  type ResourceHandlerContext,
} from "./types";

const LOADOUT_DEMO_DIR = path.resolve(__dirname, "../../examples/loadout-demo");

/**
 * Adapt OpenTeams handlers to the SDK's HandlerRegistry shape.
 *
 * Two responsibilities:
 *   1. Bridge the context shapes (SDK's HandlerContext → ours).
 *   2. Translate our code-bearing errors into MAPRequestError so the
 *      JSON-RPC error code propagates over the wire instead of being
 *      collapsed to -32603 by the transport's catch-all.
 *
 * Lives inline in the test rather than the package so OpenTeams
 * doesn't take a dependency on the SDK's error class. Real
 * consumers wiring an SDK-backed hub will write the same boundary.
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
      try {
        return await handler(params, ourCtx);
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "number") {
          throw new MAPRequestError(
            (err as { code: number }).code,
            err instanceof Error ? err.message : String(err)
          );
        }
        throw err;
      }
    };
  }
  return out;
}

interface Wired {
  store: InMemoryBundleStore;
  server: MAPServer;
  client: BaseConnection;
  clientStream: Stream;
  serverStream: Stream;
}

async function wire(): Promise<Wired> {
  const store = new InMemoryBundleStore();
  const composed = composeResourceHandlers([
    createLoadoutKindHandler({ store }),
    createTeamKindHandler({ store }),
  ]);

  const server = new MAPServer({
    capabilities: { resources: { enabled: true, kinds: composed.kinds } },
    additionalHandlers: adaptToSdkHandlers(composed),
  });

  const [clientStream, serverStream] = createStreamPair();
  const router = server.accept(serverStream, { role: "client" });
  router.start();

  const client = new BaseConnection(clientStream, {});

  // Manual handshake — the server gates non-handshake methods on session.
  await client.sendRequest("map/connect", {
    protocolVersion: PROTOCOL_VERSION,
    participantType: "client",
    name: "transport-test",
  });

  return { store, server, client, clientStream, serverStream };
}

describe("transport: real client ↔ server over stream pair", () => {
  let wired: Wired;

  beforeEach(async () => {
    wired = await wire();
  });

  afterEach(() => {
    try {
      wired.client.close();
    } catch {
      // ignore
    }
  });

  it("publishes a loadout via the SDK transport and fetches it back", async () => {
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    // Publish — wire goes JSON-RPC through createStreamPair
    const published = await wired.client.sendRequest<unknown, LoadoutResource>(
      `${LOADOUT_RESOURCE_TYPE}/publish`,
      { bundle }
    );
    expect(published.id).toBe(bundle.id);
    expect(published.type).toBe(LOADOUT_RESOURCE_TYPE);

    // Fetch — same stream, different method
    const fetched = await wired.client.sendRequest<unknown, LoadoutResource>(
      "map/resources/get",
      { type: LOADOUT_RESOURCE_TYPE, id: bundle.id }
    );
    expect(fetched.id).toBe(bundle.id);
    expect(fetched.metadata.resolved).toEqual(reviewer);
  });

  // ── Known SDK behavior: error codes don't survive the wire ────────
  //
  // Our handlers throw `ResourceNotFoundError` (code -32004) and
  // `UnknownResourceTypeError` (code -32001), and the inline adapter
  // wraps them in `MAPRequestError` to preserve the code. But the
  // SDK's router (router/connection.ts:304) has a hardcoded
  // `INTERNAL_ERROR (-32603)` catch-all that ignores `error.code`
  // and emits `-32603` for every thrown error.
  //
  // The MAPRequestError instance the *client* receives still carries
  // the error message, but `.code` is always `-32603`.
  //
  // The codes our handlers carry are still useful in-process (see
  // handlers.test.ts and integration.test.ts) — they just don't
  // round-trip the SDK transport. If the SDK starts honoring
  // MAPRequestError codes in the router, these assertions can flip
  // from -32603 back to the real codes; the tests would catch that
  // change as a positive signal.

  it("documents that our error codes collapse to -32603 over the wire", async () => {
    // OpenTeams handler throws ResourceNotFoundError (code -32004),
    // which the inline adapter wraps in MAPRequestError. The SDK's
    // router still collapses to -32603 when forwarding to the client.
    await expect(
      wired.client.sendRequest("map/resources/get", {
        type: LOADOUT_RESOURCE_TYPE,
        id: "sha256:" + "0".repeat(64),
      })
    ).rejects.toMatchObject({ code: -32603, message: expect.stringContaining("Not found") });
  });

  it("documents that unknown-resource-type errors also collapse over the wire", async () => {
    await expect(
      wired.client.sendRequest("map/resources/list", { type: "x-other/thing" })
    ).rejects.toMatchObject({ code: -32603, message: expect.stringContaining("No handler") });
  });

  it("survives a sequence of interleaved publish/get requests", async () => {
    const template = TemplateLoader.load(LOADOUT_DEMO_DIR);
    const bundles: LoadoutResource[] = [];

    // Publish all loadouts
    for (const [name, lo] of template.loadouts) {
      const bundle = bundleLoadout(lo, { version: "1.0.0", name });
      bundles.push(bundle);
      await wired.client.sendRequest(`${LOADOUT_RESOURCE_TYPE}/publish`, { bundle });
    }

    // Fetch each back, in reverse order, and confirm round-trip
    for (let i = bundles.length - 1; i >= 0; i--) {
      const expected = bundles[i]!;
      const fetched = await wired.client.sendRequest<unknown, LoadoutResource>(
        "map/resources/get",
        { type: LOADOUT_RESOURCE_TYPE, id: expected.id }
      );
      expect(fetched.id).toBe(expected.id);
    }
  });

  it("lists all published loadouts", async () => {
    const template = TemplateLoader.load(LOADOUT_DEMO_DIR);
    for (const [name, lo] of template.loadouts) {
      const bundle = bundleLoadout(lo, { version: "1.0.0", name });
      await wired.client.sendRequest(`${LOADOUT_RESOURCE_TYPE}/publish`, { bundle });
    }

    const result = await wired.client.sendRequest<
      unknown,
      { resources: LoadoutResource[]; total?: number }
    >("map/resources/list", { type: LOADOUT_RESOURCE_TYPE });

    expect(result.resources.length).toBe(template.loadouts.size);
    expect(result.total).toBe(template.loadouts.size);
  });
});
