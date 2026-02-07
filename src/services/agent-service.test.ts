import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { AgentService } from "./agent-service";
import { TeamService } from "./team-service";
import { MockSpawner } from "../spawner/mock";

describe("AgentService", () => {
  let db: Database.Database;
  let agentService: AgentService;
  let teamService: TeamService;
  let spawner: MockSpawner;

  beforeEach(() => {
    db = createInMemoryDatabase();
    spawner = new MockSpawner();
    agentService = new AgentService(db, spawner);
    teamService = new TeamService(db);
    teamService.create({ name: "test-team" });
  });

  afterEach(() => {
    db.close();
  });

  describe("spawn", () => {
    it("spawns an agent and registers it as a member", async () => {
      const member = await agentService.spawn({
        name: "researcher",
        teamName: "test-team",
        prompt: "Research the codebase",
        agentType: "explore",
        model: "sonnet",
      });

      expect(member.agent_name).toBe("researcher");
      expect(member.team_name).toBe("test-team");
      expect(member.status).toBe("running");
      expect(member.agent_id).toBeTruthy();

      expect(spawner.spawnCalls).toHaveLength(1);
      expect(spawner.spawnCalls[0].name).toBe("researcher");
      expect(spawner.spawnCalls[0].prompt).toBe("Research the codebase");
    });

    it("throws when team does not exist", async () => {
      await expect(
        agentService.spawn({
          name: "agent",
          teamName: "nope",
          prompt: "Do stuff",
        })
      ).rejects.toThrow('Team "nope" not found');
    });

    it("throws when agent name already exists and is active", async () => {
      await agentService.spawn({
        name: "worker",
        teamName: "test-team",
        prompt: "Work",
      });

      await expect(
        agentService.spawn({
          name: "worker",
          teamName: "test-team",
          prompt: "More work",
        })
      ).rejects.toThrow('Agent "worker" already exists');
    });

    it("allows re-spawning a shut down agent", async () => {
      await agentService.spawn({
        name: "worker",
        teamName: "test-team",
        prompt: "Work",
      });
      await agentService.shutdown("test-team", "worker");

      const member = await agentService.spawn({
        name: "worker",
        teamName: "test-team",
        prompt: "New work",
      });
      expect(member.status).toBe("running");
    });
  });

  describe("shutdown", () => {
    it("shuts down an agent", async () => {
      await agentService.spawn({
        name: "worker",
        teamName: "test-team",
        prompt: "Work",
      });

      await agentService.shutdown("test-team", "worker");

      const member = agentService.getMember("test-team", "worker");
      expect(member!.status).toBe("shutdown");
    });

    it("throws when agent does not exist", async () => {
      await expect(
        agentService.shutdown("test-team", "nope")
      ).rejects.toThrow('Agent "nope" not found');
    });
  });

  describe("listMembers", () => {
    it("returns all members", async () => {
      await agentService.spawn({
        name: "a",
        teamName: "test-team",
        prompt: "Work A",
      });
      await agentService.spawn({
        name: "b",
        teamName: "test-team",
        prompt: "Work B",
      });

      const members = agentService.listMembers("test-team");
      expect(members).toHaveLength(2);
    });
  });

  describe("getMember", () => {
    it("returns a specific member", async () => {
      await agentService.spawn({
        name: "finder",
        teamName: "test-team",
        prompt: "Find things",
      });

      const member = agentService.getMember("test-team", "finder");
      expect(member).not.toBeNull();
      expect(member!.agent_name).toBe("finder");
    });

    it("returns null for nonexistent member", () => {
      expect(agentService.getMember("test-team", "nope")).toBeNull();
    });
  });

  describe("getRunningInstances", () => {
    it("returns spawner's running instances", async () => {
      await agentService.spawn({
        name: "a",
        teamName: "test-team",
        prompt: "Work",
      });

      const instances = agentService.getRunningInstances();
      expect(instances).toHaveLength(1);
    });
  });
});
