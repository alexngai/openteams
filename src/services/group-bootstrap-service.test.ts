import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { GroupBootstrapService } from "./group-bootstrap-service";
import { TeamGroupService } from "./team-group-service";
import { TeamService } from "./team-service";
import { CommunicationService } from "./communication-service";
import type { GroupManifest, TeamManifest } from "../template/types";

function makeTeamManifest(name: string, roles: string[]): TeamManifest {
  return {
    name,
    version: 1,
    roles,
    topology: {
      root: { role: roles[0] },
      companions: roles.slice(1).map((r) => ({ role: r })),
    },
  };
}

describe("GroupBootstrapService", () => {
  let db: Database.Database;
  let bootstrapper: GroupBootstrapService;
  let groupService: TeamGroupService;
  let teamService: TeamService;
  let commService: CommunicationService;

  beforeEach(() => {
    db = createInMemoryDatabase();
    bootstrapper = new GroupBootstrapService(db);
    groupService = new TeamGroupService(db);
    teamService = new TeamService(db);
    commService = new CommunicationService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("bootstraps a group with multiple teams", () => {
    const manifest: GroupManifest = {
      name: "test-group",
      description: "A test group",
      version: 1,
      teams: [
        {
          name: "team-alpha",
          inline: makeTeamManifest("alpha", ["lead", "worker"]),
        },
        {
          name: "team-beta",
          inline: makeTeamManifest("beta", ["boss", "dev"]),
        },
      ],
    };

    const result = bootstrapper.bootstrapFromManifest(manifest);

    expect(result.group.name).toBe("test-group");
    expect(result.group.description).toBe("A test group");
    expect(result.teams).toHaveLength(2);

    // Both teams should be in the group
    const teams = groupService.listTeams("test-group");
    expect(teams).toHaveLength(2);
    expect(teams.map((t) => t.name).sort()).toEqual(["team-alpha", "team-beta"]);

    // Each team should have its members
    const alphaMembers = teamService.listMembers("team-alpha");
    expect(alphaMembers).toHaveLength(2);
    const betaMembers = teamService.listMembers("team-beta");
    expect(betaMembers).toHaveLength(2);
  });

  it("registers shared agents across teams", () => {
    const manifest: GroupManifest = {
      name: "shared-group",
      version: 1,
      teams: [
        {
          name: "team-a",
          inline: makeTeamManifest("a", ["orchestrator", "builder"]),
        },
        {
          name: "team-b",
          inline: makeTeamManifest("b", ["coordinator", "tester"]),
        },
      ],
      shared_agents: [
        {
          agent: "tech-lead",
          memberships: [
            { team: "team-a", role: "builder" },
            { team: "team-b", role: "tester" },
          ],
        },
      ],
    };

    const result = bootstrapper.bootstrapFromManifest(manifest);

    expect(result.sharedAgents).toHaveLength(1);
    expect(result.sharedAgents[0].agent).toBe("tech-lead");

    // tech-lead should exist in both teams
    const inA = teamService.getMember("team-a", "tech-lead");
    expect(inA).not.toBeNull();
    expect(inA!.role).toBe("builder");

    const inB = teamService.getMember("team-b", "tech-lead");
    expect(inB).not.toBeNull();
    expect(inB!.role).toBe("tester");
  });

  it("sets up bridges between teams", () => {
    const manifest: GroupManifest = {
      name: "bridged-group",
      version: 1,
      teams: [
        {
          name: "backend",
          inline: {
            name: "backend",
            version: 1,
            roles: ["server-dev"],
            topology: { root: { role: "server-dev" } },
            communication: {
              channels: {
                api_events: { signals: ["API_READY"] },
              },
            },
          },
        },
        {
          name: "frontend",
          inline: {
            name: "frontend",
            version: 1,
            roles: ["ui-dev"],
            topology: { root: { role: "ui-dev" } },
            communication: {
              channels: {
                deps: { signals: ["API_READY"] },
              },
            },
          },
        },
      ],
      bridges: [
        {
          from: { team: "backend", channel: "api_events", signals: ["API_READY"] },
          to: { team: "frontend", channel: "deps" },
          mode: "forward",
        },
      ],
    };

    const result = bootstrapper.bootstrapFromManifest(manifest);

    expect(result.bridges).toHaveLength(1);
    const bridges = groupService.listBridges("bridged-group");
    expect(bridges).toHaveLength(1);
    expect(bridges[0].source_team).toBe("backend");
    expect(bridges[0].target_team).toBe("frontend");
    expect(bridges[0].signals).toEqual(["API_READY"]);
  });

  it("allows overriding group name", () => {
    const manifest: GroupManifest = {
      name: "original",
      version: 1,
      teams: [
        {
          name: "t1",
          inline: makeTeamManifest("t1", ["worker"]),
        },
      ],
    };

    const result = bootstrapper.bootstrapFromManifest(manifest, "overridden");
    expect(result.group.name).toBe("overridden");
  });

  it("end-to-end: signal flows across bridges after bootstrap", () => {
    const manifest: GroupManifest = {
      name: "e2e-group",
      version: 1,
      teams: [
        {
          name: "producer",
          inline: {
            name: "producer",
            version: 1,
            roles: ["emitter"],
            topology: { root: { role: "emitter" } },
            communication: {
              channels: {
                out: { signals: ["DATA_READY"] },
              },
              emissions: {
                emitter: ["DATA_READY"],
              },
            },
          },
        },
        {
          name: "consumer",
          inline: {
            name: "consumer",
            version: 1,
            roles: ["receiver"],
            topology: { root: { role: "receiver" } },
            communication: {
              channels: {
                incoming: { signals: ["DATA_READY"] },
              },
              subscriptions: {
                receiver: [{ channel: "incoming" }],
              },
            },
          },
        },
      ],
      bridges: [
        {
          from: { team: "producer", channel: "out" },
          to: { team: "consumer", channel: "incoming" },
        },
      ],
    };

    bootstrapper.bootstrapFromManifest(manifest);

    // Emit in producer team with bridging
    const emitResult = commService.emitWithBridging({
      teamName: "producer",
      channel: "out",
      signal: "DATA_READY",
      sender: "emitter",
      payload: { data: "hello" },
    });

    expect(emitResult.bridged).toHaveLength(1);

    // Consumer's receiver role should see the bridged event
    const events = commService.getEventsForRole("consumer", "receiver");
    expect(events).toHaveLength(1);
    expect(events[0].signal).toBe("DATA_READY");
    expect(events[0].payload.data).toBe("hello");
  });
});
