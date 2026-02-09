import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { createMessageCommands } from "./message";
import { createTaskCommands } from "./task";
import { createTeamCommands } from "./team";
import { createAgentCommands } from "./agent";
import { TeamService } from "../services/team-service";
import { MessageService } from "../services/message-service";
import { MockSpawner } from "../spawner/mock";
import type { Command } from "commander";

describe("CLI Commands", () => {
  let db: Database.Database;
  let teamService: TeamService;
  let messageService: MessageService;
  let messageCmd: Command;
  let taskCmd: Command;
  let teamCmd: Command;
  let agentCmd: Command;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    db = createInMemoryDatabase();
    teamService = new TeamService(db);
    messageService = new MessageService(db);
    messageCmd = createMessageCommands(db);
    taskCmd = createTaskCommands(db);
    teamCmd = createTeamCommands(db);
    agentCmd = createAgentCommands(db, new MockSpawner());

    // Set up test team with members
    teamService.create({ name: "myteam" });
    teamService.addMember("myteam", "alice");
    teamService.addMember("myteam", "bob");

    // Capture console output
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      errors.push(args.map(String).join(" "));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  async function run(cmd: Command, args: string[]) {
    // commander needs the first two args as node and script path
    cmd.exitOverride(); // prevent process.exit on errors
    try {
      await cmd.parseAsync(["node", "test", ...args]);
    } catch {
      // commander may throw on --help or missing required options
    }
  }

  describe("message shutdown-response (Gap 7)", () => {
    it("approves a shutdown request", async () => {
      const req = messageService.sendShutdownRequest({
        teamName: "myteam",
        sender: "alice",
        recipient: "bob",
      });

      await run(messageCmd, [
        "shutdown-response",
        "myteam",
        "--request-id",
        req.request_id!,
        "--approve",
        "--from",
        "bob",
      ]);

      expect(logs.join("\n")).toContain("Shutdown approved");
      expect(logs.join("\n")).toContain(req.request_id!);
    });

    it("rejects a shutdown request", async () => {
      const req = messageService.sendShutdownRequest({
        teamName: "myteam",
        sender: "alice",
        recipient: "bob",
      });

      await run(messageCmd, [
        "shutdown-response",
        "myteam",
        "--request-id",
        req.request_id!,
        "--reject",
        "--from",
        "bob",
      ]);

      expect(logs.join("\n")).toContain("Shutdown rejected");
    });

    it("errors when neither --approve nor --reject is given", async () => {
      await run(messageCmd, [
        "shutdown-response",
        "myteam",
        "--request-id",
        "req-123",
      ]);

      expect(errors.join("\n")).toContain(
        "Must specify either --approve or --reject"
      );
    });
  });

  describe("message plan-response (Gap 7)", () => {
    it("approves a plan", async () => {
      await run(messageCmd, [
        "plan-response",
        "myteam",
        "--to",
        "alice",
        "--request-id",
        "plan-1",
        "--approve",
        "--from",
        "bob",
      ]);

      expect(logs.join("\n")).toContain("Plan approved");
      expect(logs.join("\n")).toContain("alice");
    });

    it("rejects a plan with feedback", async () => {
      await run(messageCmd, [
        "plan-response",
        "myteam",
        "--to",
        "bob",
        "--request-id",
        "plan-2",
        "--reject",
        "--content",
        "Needs more tests",
      ]);

      expect(logs.join("\n")).toContain("Plan rejected");
    });

    it("errors when neither --approve nor --reject is given", async () => {
      await run(messageCmd, [
        "plan-response",
        "myteam",
        "--to",
        "alice",
        "--request-id",
        "plan-3",
      ]);

      expect(errors.join("\n")).toContain(
        "Must specify either --approve or --reject"
      );
    });
  });

  describe("message poll (Gap 8)", () => {
    it("lists undelivered messages", async () => {
      messageService.send({
        teamName: "myteam",
        sender: "alice",
        recipient: "bob",
        content: "Hello Bob",
        summary: "Greeting",
      });

      await run(messageCmd, ["poll", "myteam", "--agent", "bob"]);

      expect(logs.join("\n")).toContain("Hello Bob");
      expect(logs.join("\n")).toContain("[message]");
    });

    it("shows empty message when no undelivered", async () => {
      await run(messageCmd, ["poll", "myteam", "--agent", "bob"]);

      expect(logs.join("\n")).toContain("No undelivered messages");
    });

    it("marks messages as delivered with --mark-delivered", async () => {
      messageService.send({
        teamName: "myteam",
        sender: "alice",
        recipient: "bob",
        content: "Important",
        summary: "Urgent",
      });

      await run(messageCmd, [
        "poll",
        "myteam",
        "--agent",
        "bob",
        "--mark-delivered",
      ]);

      expect(logs.join("\n")).toContain("Marked 1 message(s) as delivered");

      // Verify it's actually delivered
      const undelivered = messageService.getUndelivered("myteam", "bob");
      expect(undelivered).toHaveLength(0);
    });

    it("outputs JSON with --json flag", async () => {
      messageService.send({
        teamName: "myteam",
        sender: "alice",
        recipient: "bob",
        content: "JSON test",
        summary: "Test",
      });

      await run(messageCmd, [
        "poll",
        "myteam",
        "--agent",
        "bob",
        "--json",
      ]);

      const output = logs.join("\n");
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content).toBe("JSON test");
      expect(parsed[0].delivered).toBe(false);
    });
  });

  describe("message ack (Gap 8)", () => {
    it("marks a message as delivered", async () => {
      const msg = messageService.send({
        teamName: "myteam",
        sender: "alice",
        recipient: "bob",
        content: "Ack me",
        summary: "Test",
      });

      await run(messageCmd, ["ack", "myteam", String(msg.id)]);

      expect(logs.join("\n")).toContain(`Message #${msg.id} marked as delivered`);
      const undelivered = messageService.getUndelivered("myteam", "bob");
      expect(undelivered).toHaveLength(0);
    });

    it("errors on invalid message ID", async () => {
      await run(messageCmd, ["ack", "myteam", "abc"]);

      expect(errors.join("\n")).toContain('Invalid message ID: "abc"');
    });
  });

  describe("message list --json (Gap 9)", () => {
    it("outputs JSON array of messages", async () => {
      messageService.send({
        teamName: "myteam",
        sender: "alice",
        recipient: "bob",
        content: "Hi",
        summary: "Greeting",
      });

      await run(messageCmd, ["list", "myteam", "--json"]);

      const output = logs.join("\n");
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe("message");
      expect(parsed[0].sender).toBe("alice");
      expect(parsed[0].recipient).toBe("bob");
    });

    it("outputs empty JSON array when no messages", async () => {
      await run(messageCmd, ["list", "myteam", "--json"]);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed).toEqual([]);
    });
  });

  describe("task list --json (Gap 9)", () => {
    it("outputs JSON array of tasks", async () => {
      db.prepare(
        "INSERT INTO tasks (team_name, subject, description) VALUES (?, ?, ?)"
      ).run("myteam", "Fix bug", "Fix the critical bug");

      await run(taskCmd, ["list", "myteam", "--json"]);

      const output = logs.join("\n");
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].subject).toBe("Fix bug");
    });
  });

  describe("task get --json (Gap 9)", () => {
    it("outputs full task details as JSON", async () => {
      const result = db
        .prepare(
          "INSERT INTO tasks (team_name, subject, description, metadata) VALUES (?, ?, ?, ?)"
        )
        .run("myteam", "Task A", "Description A", '{"priority":"high"}');
      const taskId = Number(result.lastInsertRowid);

      await run(taskCmd, ["get", "myteam", String(taskId), "--json"]);

      const output = logs.join("\n");
      const parsed = JSON.parse(output);
      expect(parsed.subject).toBe("Task A");
      expect(parsed.metadata).toEqual({ priority: "high" });
      expect(parsed.blockedBy).toEqual([]);
      expect(parsed.blocks).toEqual([]);
    });
  });

  describe("agent list --json (Gap 9)", () => {
    it("outputs JSON array of members", async () => {
      await run(agentCmd, ["list", "myteam", "--json"]);

      const output = logs.join("\n");
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed.map((m: any) => m.agent_name).sort()).toEqual([
        "alice",
        "bob",
      ]);
    });
  });

  describe("team add-member (Gap 10)", () => {
    it("adds a member to a team", async () => {
      await run(teamCmd, ["add-member", "myteam", "charlie"]);

      expect(logs.join("\n")).toContain('Member "charlie" added to team "myteam"');
      const member = teamService.getMember("myteam", "charlie");
      expect(member).not.toBeNull();
      expect(member!.agent_type).toBe("general-purpose");
    });

    it("adds a member with role and type", async () => {
      await run(teamCmd, [
        "add-member",
        "myteam",
        "dave",
        "--role",
        "reviewer",
        "--type",
        "bash",
      ]);

      expect(logs.join("\n")).toContain("role: reviewer");
      const member = teamService.getMember("myteam", "dave");
      expect(member!.role).toBe("reviewer");
      expect(member!.agent_type).toBe("bash");
    });

    it("errors when team does not exist", async () => {
      await run(teamCmd, ["add-member", "nonexistent", "agent1"]);

      expect(errors.join("\n")).toContain('Team "nonexistent" not found');
    });
  });
});
