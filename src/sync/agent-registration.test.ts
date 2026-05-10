/**
 * Agent registration with OpenTeams metadata over real wire.
 *
 * Two BaseConnections to one MAPServer:
 *   - conn1 registers an agent with `AgentMetadata` (loadout/role/team/parent)
 *     in the request's `metadata` field
 *   - conn2 lists agents and verifies the metadata round-trips back
 *
 * Confirms that an OpenTeams-aware agent can plug its identity fields
 * into MAP's existing `agents/register` primitive and have them be
 * visible to other participants (orchestrators, observers, dashboards)
 * via `agents/list`. No new methods, no new event types — this is the
 * load-bearing claim that "OpenTeams ships zero new wire protocol."
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  BaseConnection,
  PROTOCOL_VERSION,
  createStreamPair,
  type Stream,
} from "@multi-agent-protocol/sdk";
import { MAPServer } from "@multi-agent-protocol/sdk/server";

import { loadoutRef, teamRef } from "./uri";
import type { AgentMetadata } from "./types";

interface Agent {
  id: string;
  name?: string;
  role?: string;
  metadata?: Record<string, unknown>;
}

interface AgentsListResult {
  agents: Agent[];
}

interface AgentsRegisterResult {
  agent: Agent;
}

async function connect(server: MAPServer, name: string): Promise<BaseConnection> {
  const [clientStream, serverStream] = createStreamPair();
  const router = server.accept(serverStream, { role: "client" });
  router.start();
  const conn = new BaseConnection(clientStream, {});
  await conn.sendRequest("map/connect", {
    protocolVersion: PROTOCOL_VERSION,
    participantType: "client",
    name,
  });
  return conn;
}

describe("agent registration with AgentMetadata over wire", () => {
  let server: MAPServer;
  let openConnections: BaseConnection[];

  beforeEach(() => {
    server = new MAPServer({});
    openConnections = [];
  });

  afterEach(async () => {
    for (const c of openConnections) {
      try {
        c.close();
      } catch {
        // ignore
      }
    }
    await server.close({ timeout: 1000 });
  });

  it("round-trips loadout/role/team/parent through agents/register and agents/list", async () => {
    const registrar = await connect(server, "registrar");
    const observer = await connect(server, "observer");
    openConnections.push(registrar, observer);

    const ourMetadata: AgentMetadata = {
      loadout: loadoutRef("sha256:" + "a".repeat(64)),
      role: "executor",
      team: teamRef("sha256:" + "b".repeat(64)),
      parent: "agent-orchestrator-1",
    };

    // OpenTeams-aware agent registers itself
    const registered = await registrar.sendRequest<unknown, AgentsRegisterResult>(
      "map/agents/register",
      {
        name: "executor-1",
        metadata: ourMetadata,
      }
    );

    expect(registered.agent.id).toBeTruthy();
    expect(registered.agent.metadata).toMatchObject(ourMetadata);

    // Observer (a separate connection) sees the agent and its metadata
    const list = await observer.sendRequest<unknown, AgentsListResult>(
      "map/agents/list",
      {}
    );

    const found = list.agents.find((a) => a.id === registered.agent.id);
    expect(found).toBeDefined();
    expect(found?.metadata).toMatchObject(ourMetadata);
  });

  it("preserves metadata structurally — observer can reconstruct OpenTeams identity from it", async () => {
    const registrar = await connect(server, "registrar");
    const observer = await connect(server, "observer");
    openConnections.push(registrar, observer);

    const loadoutId = "sha256:" + "1".repeat(64);
    const teamId = "sha256:" + "2".repeat(64);

    await registrar.sendRequest("map/agents/register", {
      name: "leaf-agent",
      metadata: {
        loadout: loadoutRef(loadoutId),
        role: "reviewer",
        // intentionally omit team and parent — they're optional per design
      } satisfies AgentMetadata,
    });

    const list = await observer.sendRequest<unknown, AgentsListResult>(
      "map/agents/list",
      {}
    );
    const found = list.agents.find((a) => a.name === "leaf-agent");
    expect(found).toBeDefined();

    // Observer reconstructs OpenTeams identity from metadata fields
    const m = found!.metadata as AgentMetadata;
    expect(m.loadout).toBe(loadoutRef(loadoutId));
    expect(m.role).toBe("reviewer");
    expect(m.team).toBeUndefined();
    expect(m.parent).toBeUndefined();
  });

  it("supports a leaf-agent registration with only the required loadout field", async () => {
    const registrar = await connect(server, "registrar");
    const observer = await connect(server, "observer");
    openConnections.push(registrar, observer);

    const loadoutId = "sha256:" + "9".repeat(64);
    await registrar.sendRequest("map/agents/register", {
      name: "minimal",
      metadata: { loadout: loadoutRef(loadoutId) } satisfies AgentMetadata,
    });

    const list = await observer.sendRequest<unknown, AgentsListResult>(
      "map/agents/list",
      {}
    );
    const found = list.agents.find((a) => a.name === "minimal");
    expect(found?.metadata).toEqual({ loadout: loadoutRef(loadoutId) });
  });

  it("multiple agents from the same registrar each carry their own metadata", async () => {
    const registrar = await connect(server, "registrar");
    const observer = await connect(server, "observer");
    openConnections.push(registrar, observer);

    const loadoutA = loadoutRef("sha256:" + "a".repeat(64));
    const loadoutB = loadoutRef("sha256:" + "b".repeat(64));

    await registrar.sendRequest("map/agents/register", {
      name: "agent-a",
      metadata: { loadout: loadoutA, role: "planner" } satisfies AgentMetadata,
    });
    await registrar.sendRequest("map/agents/register", {
      name: "agent-b",
      metadata: { loadout: loadoutB, role: "executor" } satisfies AgentMetadata,
    });

    const list = await observer.sendRequest<unknown, AgentsListResult>(
      "map/agents/list",
      {}
    );
    const a = list.agents.find((a) => a.name === "agent-a");
    const b = list.agents.find((a) => a.name === "agent-b");

    expect((a?.metadata as AgentMetadata).loadout).toBe(loadoutA);
    expect((b?.metadata as AgentMetadata).loadout).toBe(loadoutB);
  });
});
