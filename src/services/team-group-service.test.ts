import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { TeamService } from "./team-service";
import { TeamGroupService } from "./team-group-service";
import { CommunicationService } from "./communication-service";

describe("TeamGroupService", () => {
  let db: Database.Database;
  let groupService: TeamGroupService;
  let teamService: TeamService;
  let commService: CommunicationService;

  beforeEach(() => {
    db = createInMemoryDatabase();
    groupService = new TeamGroupService(db);
    teamService = new TeamService(db);
    commService = new CommunicationService(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- Group CRUD ---

  describe("create", () => {
    it("creates a group with name only", () => {
      const group = groupService.create({ name: "my-group" });
      expect(group.name).toBe("my-group");
      expect(group.description).toBeNull();
      expect(group.status).toBe("active");
    });

    it("creates a group with description", () => {
      const group = groupService.create({
        name: "my-group",
        description: "A group of teams",
      });
      expect(group.description).toBe("A group of teams");
    });

    it("throws when group already exists", () => {
      groupService.create({ name: "dup" });
      expect(() => groupService.create({ name: "dup" })).toThrow(
        'Team group "dup" already exists'
      );
    });
  });

  describe("get", () => {
    it("returns the group by name", () => {
      groupService.create({ name: "my-group" });
      const group = groupService.get("my-group");
      expect(group).not.toBeNull();
      expect(group!.name).toBe("my-group");
    });

    it("returns null for nonexistent group", () => {
      expect(groupService.get("nope")).toBeNull();
    });

    it("returns null for deleted group", () => {
      groupService.create({ name: "del" });
      teamService.create({ name: "t1" }); // need a team to avoid delete error... actually groups don't need teams to be deleted
      groupService.delete("del");
      expect(groupService.get("del")).toBeNull();
    });
  });

  describe("list", () => {
    it("returns all active groups", () => {
      groupService.create({ name: "a" });
      groupService.create({ name: "b" });
      const groups = groupService.list();
      expect(groups).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("soft-deletes a group", () => {
      groupService.create({ name: "del-me" });
      groupService.delete("del-me");
      expect(groupService.get("del-me")).toBeNull();
    });

    it("throws when group not found", () => {
      expect(() => groupService.delete("nope")).toThrow(
        'Team group "nope" not found'
      );
    });

    it("throws when group still has teams", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      groupService.addTeam("grp", "t1");

      expect(() => groupService.delete("grp")).toThrow(
        'Team group "grp" still has 1 team(s)'
      );
    });
  });

  // --- Group ↔ Team membership ---

  describe("addTeam", () => {
    it("adds a team to a group", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      groupService.addTeam("grp", "t1");

      const teams = groupService.listTeams("grp");
      expect(teams).toHaveLength(1);
      expect(teams[0].name).toBe("t1");
      expect(teams[0].group_name).toBe("grp");
    });

    it("throws when group not found", () => {
      teamService.create({ name: "t1" });
      expect(() => groupService.addTeam("nope", "t1")).toThrow(
        'Team group "nope" not found'
      );
    });

    it("throws when team not found", () => {
      groupService.create({ name: "grp" });
      expect(() => groupService.addTeam("grp", "nope")).toThrow(
        'Team "nope" not found'
      );
    });

    it("throws when team is already in another group", () => {
      groupService.create({ name: "grp1" });
      groupService.create({ name: "grp2" });
      teamService.create({ name: "t1" });
      groupService.addTeam("grp1", "t1");

      expect(() => groupService.addTeam("grp2", "t1")).toThrow(
        'Team "t1" is already in group "grp1"'
      );
    });

    it("is idempotent when adding to same group", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      groupService.addTeam("grp", "t1");
      groupService.addTeam("grp", "t1"); // no-op
      expect(groupService.listTeams("grp")).toHaveLength(1);
    });
  });

  describe("removeTeam", () => {
    it("removes a team from a group", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      groupService.addTeam("grp", "t1");
      groupService.removeTeam("grp", "t1");

      expect(groupService.listTeams("grp")).toHaveLength(0);
      const team = teamService.get("t1");
      expect(team!.group_name).toBeNull();
    });

    it("throws when team is not in group", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      expect(() => groupService.removeTeam("grp", "t1")).toThrow(
        'Team "t1" is not in group "grp"'
      );
    });

    it("cleans up bridges when removing a team", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      teamService.create({ name: "t2" });
      groupService.addTeam("grp", "t1");
      groupService.addTeam("grp", "t2");

      // Set up communication channels for bridge validation
      commService.applyConfig("t1", {
        channels: { events: { signals: ["SIG_A"] } },
      });
      commService.applyConfig("t2", {
        channels: { updates: { signals: ["SIG_A"] } },
      });

      groupService.addBridge({
        groupName: "grp",
        sourceTeam: "t1",
        targetTeam: "t2",
        sourceChannel: "events",
        targetChannel: "updates",
      });

      expect(groupService.listBridges("grp")).toHaveLength(1);
      groupService.removeTeam("grp", "t1");
      expect(groupService.listBridges("grp")).toHaveLength(0);
    });
  });

  // --- Bridges ---

  describe("addBridge", () => {
    beforeEach(() => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      teamService.create({ name: "t2" });
      groupService.addTeam("grp", "t1");
      groupService.addTeam("grp", "t2");
    });

    it("creates a forward bridge between teams", () => {
      const bridge = groupService.addBridge({
        groupName: "grp",
        sourceTeam: "t1",
        targetTeam: "t2",
        sourceChannel: "events",
        targetChannel: "updates",
        signals: ["SIG_A", "SIG_B"],
        mode: "forward",
      });

      expect(bridge.source_team).toBe("t1");
      expect(bridge.target_team).toBe("t2");
      expect(bridge.source_channel).toBe("events");
      expect(bridge.target_channel).toBe("updates");
      expect(bridge.signals).toEqual(["SIG_A", "SIG_B"]);
      expect(bridge.mode).toBe("forward");
    });

    it("defaults to forward mode", () => {
      const bridge = groupService.addBridge({
        groupName: "grp",
        sourceTeam: "t1",
        targetTeam: "t2",
        sourceChannel: "a",
        targetChannel: "b",
      });
      expect(bridge.mode).toBe("forward");
    });

    it("creates a bidirectional bridge", () => {
      const bridge = groupService.addBridge({
        groupName: "grp",
        sourceTeam: "t1",
        targetTeam: "t2",
        sourceChannel: "shared",
        targetChannel: "shared",
        mode: "bidirectional",
      });
      expect(bridge.mode).toBe("bidirectional");
    });

    it("throws when source team not in group", () => {
      teamService.create({ name: "outsider" });
      expect(() =>
        groupService.addBridge({
          groupName: "grp",
          sourceTeam: "outsider",
          targetTeam: "t2",
          sourceChannel: "a",
          targetChannel: "b",
        })
      ).toThrow('Team "outsider" is not in group "grp"');
    });

    it("throws when bridging a team to itself", () => {
      expect(() =>
        groupService.addBridge({
          groupName: "grp",
          sourceTeam: "t1",
          targetTeam: "t1",
          sourceChannel: "a",
          targetChannel: "b",
        })
      ).toThrow("Cannot bridge a team to itself");
    });
  });

  describe("removeBridge", () => {
    it("removes a bridge", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      teamService.create({ name: "t2" });
      groupService.addTeam("grp", "t1");
      groupService.addTeam("grp", "t2");

      const bridge = groupService.addBridge({
        groupName: "grp",
        sourceTeam: "t1",
        targetTeam: "t2",
        sourceChannel: "a",
        targetChannel: "b",
      });

      groupService.removeBridge(bridge.id);
      expect(groupService.listBridges("grp")).toHaveLength(0);
    });

    it("throws when bridge not found", () => {
      expect(() => groupService.removeBridge(999)).toThrow(
        "Bridge 999 not found"
      );
    });
  });

  describe("getBridgesForSource", () => {
    it("returns forward bridges from a team+channel", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      teamService.create({ name: "t2" });
      groupService.addTeam("grp", "t1");
      groupService.addTeam("grp", "t2");

      groupService.addBridge({
        groupName: "grp",
        sourceTeam: "t1",
        targetTeam: "t2",
        sourceChannel: "events",
        targetChannel: "updates",
      });

      const bridges = groupService.getBridgesForSource("t1", "events");
      expect(bridges).toHaveLength(1);
      expect(bridges[0].target_team).toBe("t2");
    });

    it("includes bidirectional bridges from target side", () => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "t1" });
      teamService.create({ name: "t2" });
      groupService.addTeam("grp", "t1");
      groupService.addTeam("grp", "t2");

      groupService.addBridge({
        groupName: "grp",
        sourceTeam: "t1",
        targetTeam: "t2",
        sourceChannel: "shared",
        targetChannel: "shared",
        mode: "bidirectional",
      });

      // t2 should see the bridge when emitting on "shared"
      const bridges = groupService.getBridgesForSource("t2", "shared");
      expect(bridges).toHaveLength(1);
    });

    it("returns empty for teams not in a group", () => {
      teamService.create({ name: "solo" });
      expect(groupService.getBridgesForSource("solo", "events")).toHaveLength(0);
    });
  });

  // --- Cross-team signal forwarding ---

  describe("cross-team signal emission", () => {
    beforeEach(() => {
      groupService.create({ name: "grp" });
      teamService.create({ name: "alpha" });
      teamService.create({ name: "beta" });
      groupService.addTeam("grp", "alpha");
      groupService.addTeam("grp", "beta");

      // Set up channels in alpha
      commService.applyConfig("alpha", {
        channels: {
          api_events: { signals: ["API_READY", "API_CHANGE"] },
        },
        emissions: {
          backend: ["API_READY", "API_CHANGE"],
        },
      });

      // Set up channels in beta
      commService.applyConfig("beta", {
        channels: {
          dependency_updates: { signals: ["API_READY", "API_CHANGE"] },
        },
        subscriptions: {
          frontend: [{ channel: "dependency_updates" }],
        },
      });

      // Bridge: alpha/api_events → beta/dependency_updates
      groupService.addBridge({
        groupName: "grp",
        sourceTeam: "alpha",
        targetTeam: "beta",
        sourceChannel: "api_events",
        targetChannel: "dependency_updates",
        signals: ["API_READY"],
      });
    });

    it("forwards signals across team boundaries via emitWithBridging", () => {
      const result = commService.emitWithBridging({
        teamName: "alpha",
        channel: "api_events",
        signal: "API_READY",
        sender: "backend",
        payload: { version: "2.0" },
      });

      // Original event in alpha
      expect(result.event.team_name).toBe("alpha");
      expect(result.bridged).toHaveLength(1);

      // Bridged event in beta
      const bridged = result.bridged[0];
      expect(bridged.team_name).toBe("beta");
      expect(bridged.channel).toBe("dependency_updates");
      expect(bridged.signal).toBe("API_READY");
      expect(bridged.sender).toBe("bridge:alpha:backend");
      expect(bridged.payload._bridged_from).toEqual({
        team: "alpha",
        channel: "api_events",
        sender: "backend",
      });
    });

    it("does not forward signals not in the bridge's signal list", () => {
      const result = commService.emitWithBridging({
        teamName: "alpha",
        channel: "api_events",
        signal: "API_CHANGE",
        sender: "backend",
      });

      expect(result.bridged).toHaveLength(0);
    });

    it("bridged events are visible to subscribing roles in target team", () => {
      commService.emitWithBridging({
        teamName: "alpha",
        channel: "api_events",
        signal: "API_READY",
        sender: "backend",
      });

      const events = commService.getEventsForRole("beta", "frontend");
      expect(events).toHaveLength(1);
      expect(events[0].signal).toBe("API_READY");
      expect(events[0].team_name).toBe("beta");
    });

    it("regular emit does not forward across bridges", () => {
      commService.emit({
        teamName: "alpha",
        channel: "api_events",
        signal: "API_READY",
        sender: "backend",
      });

      // beta should not see anything
      const events = commService.getEventsForRole("beta", "frontend");
      expect(events).toHaveLength(0);
    });
  });
});
