import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { TeamService } from "./team-service";

describe("TeamService", () => {
  let db: Database.Database;
  let service: TeamService;

  beforeEach(() => {
    db = createInMemoryDatabase();
    service = new TeamService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("create", () => {
    it("creates a team with name only", () => {
      const team = service.create({ name: "test-team" });
      expect(team.name).toBe("test-team");
      expect(team.description).toBeNull();
      expect(team.agent_type).toBeNull();
      expect(team.status).toBe("active");
    });

    it("creates a team with description and agent type", () => {
      const team = service.create({
        name: "my-project",
        description: "A test project",
        agentType: "general-purpose",
      });
      expect(team.name).toBe("my-project");
      expect(team.description).toBe("A test project");
      expect(team.agent_type).toBe("general-purpose");
    });

    it("throws on duplicate team name", () => {
      service.create({ name: "dup" });
      expect(() => service.create({ name: "dup" })).toThrow(
        'Team "dup" already exists'
      );
    });
  });

  describe("get", () => {
    it("returns null for nonexistent team", () => {
      expect(service.get("nope")).toBeNull();
    });

    it("returns the team by name", () => {
      service.create({ name: "findme" });
      const team = service.get("findme");
      expect(team).not.toBeNull();
      expect(team!.name).toBe("findme");
    });

    it("does not return deleted teams", () => {
      service.create({ name: "gone" });
      service.delete("gone");
      expect(service.get("gone")).toBeNull();
    });
  });

  describe("list", () => {
    it("returns empty array when no teams", () => {
      expect(service.list()).toEqual([]);
    });

    it("returns active teams", () => {
      service.create({ name: "a" });
      service.create({ name: "b" });
      const teams = service.list();
      expect(teams).toHaveLength(2);
    });

    it("excludes deleted teams", () => {
      service.create({ name: "keep" });
      service.create({ name: "remove" });
      service.delete("remove");
      const teams = service.list();
      expect(teams).toHaveLength(1);
      expect(teams[0].name).toBe("keep");
    });
  });

  describe("delete", () => {
    it("soft-deletes a team", () => {
      service.create({ name: "deleteme" });
      service.delete("deleteme");
      expect(service.get("deleteme")).toBeNull();
    });

    it("throws when team not found", () => {
      expect(() => service.delete("nope")).toThrow('Team "nope" not found');
    });

    it("throws when team has active members", () => {
      service.create({ name: "busy" });
      service.addMember("busy", "agent1");
      expect(() => service.delete("busy")).toThrow("active member");
    });

    it("allows delete when all members are shut down", () => {
      service.create({ name: "done" });
      service.addMember("done", "agent1");
      service.updateMemberStatus("done", "agent1", "shutdown");
      service.delete("done");
      expect(service.get("done")).toBeNull();
    });
  });

  describe("members", () => {
    it("adds a member to a team", () => {
      service.create({ name: "team1" });
      const member = service.addMember("team1", "researcher");
      expect(member.agent_name).toBe("researcher");
      expect(member.team_name).toBe("team1");
      expect(member.status).toBe("idle");
      expect(member.agent_type).toBe("general-purpose");
    });

    it("adds a member with options", () => {
      service.create({ name: "team1" });
      const member = service.addMember("team1", "coder", {
        agentId: "abc-123",
        agentType: "bash",
        spawnPrompt: "Run tests",
        model: "sonnet",
      });
      expect(member.agent_id).toBe("abc-123");
      expect(member.agent_type).toBe("bash");
      expect(member.spawn_prompt).toBe("Run tests");
      expect(member.model).toBe("sonnet");
    });

    it("throws when adding member to nonexistent team", () => {
      expect(() => service.addMember("nope", "agent")).toThrow(
        'Team "nope" not found'
      );
    });

    it("lists members", () => {
      service.create({ name: "team1" });
      service.addMember("team1", "a");
      service.addMember("team1", "b");
      const members = service.listMembers("team1");
      expect(members).toHaveLength(2);
    });

    it("gets a specific member", () => {
      service.create({ name: "team1" });
      service.addMember("team1", "finder");
      const member = service.getMember("team1", "finder");
      expect(member).not.toBeNull();
      expect(member!.agent_name).toBe("finder");
    });

    it("returns null for nonexistent member", () => {
      service.create({ name: "team1" });
      expect(service.getMember("team1", "nope")).toBeNull();
    });

    it("updates member status", () => {
      service.create({ name: "team1" });
      service.addMember("team1", "worker");
      service.updateMemberStatus("team1", "worker", "running");
      const member = service.getMember("team1", "worker");
      expect(member!.status).toBe("running");
    });

    it("updates member agent id", () => {
      service.create({ name: "team1" });
      service.addMember("team1", "worker");
      service.updateMemberAgentId("team1", "worker", "new-id-123");
      const member = service.getMember("team1", "worker");
      expect(member!.agent_id).toBe("new-id-123");
    });
  });
});
