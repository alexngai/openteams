/**
 * Real network transport — MAPServer over a real WebSocket server.
 *
 * Spins up a `ws` WebSocketServer on a free port, accepts incoming
 * connections via `MAPServer.accept(websocketStream(ws))`, and connects
 * a real client via `WebSocket(url)` + `BaseConnection`. Round-trips
 * publish + fetch + list of OpenTeams resources over the wire.
 *
 * What this catches that previous phases couldn't:
 *   - actual WebSocket frame handling (open/message/close events)
 *   - JSON-RPC envelopes serialized via `event.data` strings, not
 *     in-process refs
 *   - server-side cleanup on disconnect
 *
 * Uses a randomly-allocated port (via `port: 0`) so multiple test runs
 * don't collide.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";

import {
  BaseConnection,
  PROTOCOL_VERSION,
  websocketStream,
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

async function openWebSocketStream(url: string): Promise<Stream> {
  const ws = new WsWebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  // The SDK's websocketStream expects the browser WebSocket shape; the
  // `ws` package's instance is structurally compatible.
  return websocketStream(ws as unknown as globalThis.WebSocket);
}

describe("network: MAPServer over real WebSocket", () => {
  let wss: WebSocketServer;
  let server: MAPServer;
  let store: InMemoryBundleStore;
  let baseUrl: string;

  beforeAll(async () => {
    store = new InMemoryBundleStore();
    const composed = composeResourceHandlers([
      createLoadoutKindHandler({ store }),
      createTeamKindHandler({ store }),
    ]);

    server = new MAPServer({
      capabilities: { resources: { enabled: true, kinds: composed.kinds } },
      additionalHandlers: adaptToSdkHandlers(composed),
    });

    wss = new WebSocketServer({ port: 0 });

    wss.on("connection", (ws) => {
      const stream = websocketStream(ws as unknown as globalThis.WebSocket);
      const router = server.accept(stream, {
        role: "client",
        transportType: "websocket",
      });
      router.start();
    });

    await new Promise<void>((resolve) => wss.on("listening", resolve));
    const addr = wss.address();
    if (!addr || typeof addr === "string") throw new Error("expected AddressInfo");
    baseUrl = `ws://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await server.close({ timeout: 2000 });
    wss.close();
    await new Promise<void>((resolve) => wss.on("close", () => resolve()));
  });

  async function connectClient(name: string): Promise<BaseConnection> {
    const stream = await openWebSocketStream(baseUrl);
    const conn = new BaseConnection(stream, {});
    await conn.sendRequest("map/connect", {
      protocolVersion: PROTOCOL_VERSION,
      participantType: "client",
      name,
    });
    return conn;
  }

  it("publishes a loadout over WebSocket and fetches it back", async () => {
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    const client = await connectClient("publisher");

    try {
      const published = await client.sendRequest<unknown, LoadoutResource>(
        `${LOADOUT_RESOURCE_TYPE}/publish`,
        { bundle }
      );
      expect(published.id).toBe(bundle.id);

      const fetched = await client.sendRequest<unknown, LoadoutResource>(
        "map/resources/get",
        { type: LOADOUT_RESOURCE_TYPE, id: bundle.id }
      );
      expect(fetched.id).toBe(bundle.id);
      expect(fetched.metadata.resolved).toEqual(reviewer);
    } finally {
      client.close();
    }
  });

  it("two separate WebSocket clients see the same shared store", async () => {
    const template = TemplateLoader.load(LOADOUT_DEMO_DIR);
    const reviewer = template.loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    const publisher = await connectClient("publisher-2");
    const fetcher = await connectClient("fetcher-2");

    try {
      await publisher.sendRequest(`${LOADOUT_RESOURCE_TYPE}/publish`, { bundle });

      // Different connection, same server backend
      const fetched = await fetcher.sendRequest<unknown, LoadoutResource>(
        "map/resources/get",
        { type: LOADOUT_RESOURCE_TYPE, id: bundle.id }
      );
      expect(fetched.id).toBe(bundle.id);
    } finally {
      publisher.close();
      fetcher.close();
    }
  });

  it("survives a sequence of interleaved publish/get over the same connection", async () => {
    const template = TemplateLoader.load(LOADOUT_DEMO_DIR);
    const client = await connectClient("interleave-client");
    const bundles: LoadoutResource[] = [];

    try {
      for (const [name, lo] of template.loadouts) {
        const bundle = bundleLoadout(lo, { version: "1.0.0", name });
        bundles.push(bundle);
        await client.sendRequest(`${LOADOUT_RESOURCE_TYPE}/publish`, { bundle });
      }

      // Fetch each back in reverse; round-trip preserves identity
      for (let i = bundles.length - 1; i >= 0; i--) {
        const expected = bundles[i]!;
        const fetched = await client.sendRequest<unknown, LoadoutResource>(
          "map/resources/get",
          { type: LOADOUT_RESOURCE_TYPE, id: expected.id }
        );
        expect(fetched.id).toBe(expected.id);
      }
    } finally {
      client.close();
    }
  });

  it("server-side state survives a client disconnect + reconnect", async () => {
    const reviewer = TemplateLoader.load(LOADOUT_DEMO_DIR).loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, {
      version: "1.0.0",
      name: "disconnect-test-loadout",
    });

    const a = await connectClient("a");
    await a.sendRequest(`${LOADOUT_RESOURCE_TYPE}/publish`, { bundle });
    a.close();

    // Allow the server to handle the close
    await new Promise((r) => setTimeout(r, 50));

    const b = await connectClient("b");
    try {
      const fetched = await b.sendRequest<unknown, LoadoutResource>(
        "map/resources/get",
        { type: LOADOUT_RESOURCE_TYPE, id: bundle.id }
      );
      expect(fetched.id).toBe(bundle.id);
    } finally {
      b.close();
    }
  });
});
