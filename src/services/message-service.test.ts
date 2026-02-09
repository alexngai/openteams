import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { MessageService } from "./message-service";
import { TeamService } from "./team-service";

describe("MessageService", () => {
  let db: Database.Database;
  let messageService: MessageService;
  let teamService: TeamService;

  beforeEach(() => {
    db = createInMemoryDatabase();
    messageService = new MessageService(db);
    teamService = new TeamService(db);

    teamService.create({ name: "test-team" });
    teamService.addMember("test-team", "alice");
    teamService.addMember("test-team", "bob");
    teamService.addMember("test-team", "charlie");
  });

  afterEach(() => {
    db.close();
  });

  describe("team validation", () => {
    it("send throws when team does not exist", () => {
      expect(() =>
        messageService.send({
          teamName: "nonexistent",
          sender: "alice",
          recipient: "bob",
          content: "Hi",
          summary: "Greeting",
        })
      ).toThrow('Team "nonexistent" not found');
    });

    it("broadcast throws when team does not exist", () => {
      expect(() =>
        messageService.broadcast({
          teamName: "nonexistent",
          sender: "alice",
          content: "Hi",
          summary: "Greeting",
        })
      ).toThrow('Team "nonexistent" not found');
    });

    it("sendShutdownRequest throws when team does not exist", () => {
      expect(() =>
        messageService.sendShutdownRequest({
          teamName: "nonexistent",
          sender: "lead",
          recipient: "alice",
        })
      ).toThrow('Team "nonexistent" not found');
    });

    it("send throws when recipient is not a member", () => {
      expect(() =>
        messageService.send({
          teamName: "test-team",
          sender: "alice",
          recipient: "ghost",
          content: "Hi",
          summary: "Greeting",
        })
      ).toThrow('Agent "ghost" is not a member of team "test-team"');
    });

    it("sendShutdownRequest throws when recipient is not a member", () => {
      expect(() =>
        messageService.sendShutdownRequest({
          teamName: "test-team",
          sender: "lead",
          recipient: "ghost",
        })
      ).toThrow('Agent "ghost" is not a member of team "test-team"');
    });

    it("sendPlanApprovalResponse throws when recipient is not a member", () => {
      expect(() =>
        messageService.sendPlanApprovalResponse({
          teamName: "test-team",
          sender: "lead",
          recipient: "ghost",
          requestId: "req-1",
          approve: true,
        })
      ).toThrow('Agent "ghost" is not a member of team "test-team"');
    });
  });

  describe("send", () => {
    it("sends a direct message", () => {
      const msg = messageService.send({
        teamName: "test-team",
        sender: "alice",
        recipient: "bob",
        content: "Hello Bob",
        summary: "Greeting from Alice",
      });
      expect(msg.id).toBeGreaterThan(0);
      expect(msg.type).toBe("message");
      expect(msg.sender).toBe("alice");
      expect(msg.recipient).toBe("bob");
      expect(msg.content).toBe("Hello Bob");
      expect(msg.summary).toBe("Greeting from Alice");
      expect(msg.delivered).toBe(false);
    });
  });

  describe("broadcast", () => {
    it("sends to all non-shutdown members except sender", () => {
      const msgs = messageService.broadcast({
        teamName: "test-team",
        sender: "alice",
        content: "Team announcement",
        summary: "Important update for team",
      });
      // alice is sender, so only bob and charlie
      expect(msgs).toHaveLength(2);
      expect(msgs.every((m) => m.type === "broadcast")).toBe(true);
      const recipients = msgs.map((m) => m.recipient).sort();
      expect(recipients).toEqual(["bob", "charlie"]);
    });

    it("skips shut down members", () => {
      teamService.updateMemberStatus("test-team", "charlie", "shutdown");
      const msgs = messageService.broadcast({
        teamName: "test-team",
        sender: "alice",
        content: "Update",
        summary: "Update for active members",
      });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].recipient).toBe("bob");
    });
  });

  describe("sendShutdownRequest", () => {
    it("creates a shutdown request with request_id", () => {
      const msg = messageService.sendShutdownRequest({
        teamName: "test-team",
        sender: "lead",
        recipient: "alice",
        reason: "Work complete",
      });
      expect(msg.type).toBe("shutdown_request");
      expect(msg.recipient).toBe("alice");
      expect(msg.request_id).toBeTruthy();
      expect(msg.content).toBe("Work complete");
    });

    it("uses default reason when none provided", () => {
      const msg = messageService.sendShutdownRequest({
        teamName: "test-team",
        sender: "lead",
        recipient: "alice",
      });
      expect(msg.content).toBe("Shutdown requested");
    });
  });

  describe("sendShutdownResponse", () => {
    it("creates an approval response", () => {
      const req = messageService.sendShutdownRequest({
        teamName: "test-team",
        sender: "lead",
        recipient: "alice",
      });
      const resp = messageService.sendShutdownResponse({
        teamName: "test-team",
        sender: "alice",
        requestId: req.request_id!,
        approve: true,
      });
      expect(resp.type).toBe("shutdown_response");
      expect(resp.approve).toBe(true);
      expect(resp.request_id).toBe(req.request_id);
    });

    it("creates a rejection response", () => {
      const req = messageService.sendShutdownRequest({
        teamName: "test-team",
        sender: "lead",
        recipient: "bob",
      });
      const resp = messageService.sendShutdownResponse({
        teamName: "test-team",
        sender: "bob",
        requestId: req.request_id!,
        approve: false,
        content: "Still working",
      });
      expect(resp.approve).toBe(false);
      expect(resp.content).toBe("Still working");
    });
  });

  describe("sendPlanApprovalResponse", () => {
    it("creates a plan approval", () => {
      const msg = messageService.sendPlanApprovalResponse({
        teamName: "test-team",
        sender: "lead",
        recipient: "alice",
        requestId: "plan-123",
        approve: true,
      });
      expect(msg.type).toBe("plan_approval_response");
      expect(msg.approve).toBe(true);
      expect(msg.request_id).toBe("plan-123");
    });

    it("creates a plan rejection with feedback", () => {
      const msg = messageService.sendPlanApprovalResponse({
        teamName: "test-team",
        sender: "lead",
        recipient: "alice",
        requestId: "plan-456",
        approve: false,
        content: "Need tests",
      });
      expect(msg.approve).toBe(false);
      expect(msg.content).toBe("Need tests");
    });
  });

  describe("listing", () => {
    it("listForTeam returns all messages", () => {
      messageService.send({
        teamName: "test-team",
        sender: "alice",
        recipient: "bob",
        content: "Hi",
        summary: "Greeting",
      });
      messageService.send({
        teamName: "test-team",
        sender: "bob",
        recipient: "charlie",
        content: "Hello",
        summary: "Reply",
      });

      const msgs = messageService.listForTeam("test-team");
      expect(msgs).toHaveLength(2);
    });

    it("listForAgent returns relevant messages", () => {
      messageService.send({
        teamName: "test-team",
        sender: "alice",
        recipient: "bob",
        content: "For Bob",
        summary: "To Bob",
      });
      messageService.send({
        teamName: "test-team",
        sender: "bob",
        recipient: "charlie",
        content: "From Bob",
        summary: "From Bob",
      });
      messageService.send({
        teamName: "test-team",
        sender: "charlie",
        recipient: "alice",
        content: "Not for Bob",
        summary: "To Alice",
      });

      const msgs = messageService.listForAgent("test-team", "bob");
      expect(msgs).toHaveLength(2); // received one, sent one
    });

    it("listForAgent only returns broadcasts addressed to that agent", () => {
      // alice broadcasts to bob and charlie (per-recipient rows)
      messageService.broadcast({
        teamName: "test-team",
        sender: "alice",
        content: "Team update",
        summary: "Broadcast",
      });

      const bobMsgs = messageService.listForAgent("test-team", "bob");
      const bobBroadcasts = bobMsgs.filter((m) => m.type === "broadcast");
      expect(bobBroadcasts).toHaveLength(1);
      expect(bobBroadcasts[0].recipient).toBe("bob");

      // charlie should only see their own copy
      const charlieMsgs = messageService.listForAgent("test-team", "charlie");
      const charlieBroadcasts = charlieMsgs.filter((m) => m.type === "broadcast");
      expect(charlieBroadcasts).toHaveLength(1);
      expect(charlieBroadcasts[0].recipient).toBe("charlie");

      // alice (sender) should see both as sender, not as broadcast recipient
      const aliceMsgs = messageService.listForAgent("test-team", "alice");
      const aliceBroadcasts = aliceMsgs.filter((m) => m.type === "broadcast");
      expect(aliceBroadcasts).toHaveLength(2); // sent to bob + charlie
      expect(aliceBroadcasts.every((m) => m.sender === "alice")).toBe(true);
    });
  });

  describe("delivery tracking", () => {
    it("getUndelivered returns undelivered messages", () => {
      messageService.send({
        teamName: "test-team",
        sender: "alice",
        recipient: "bob",
        content: "Msg 1",
        summary: "First",
      });
      messageService.send({
        teamName: "test-team",
        sender: "alice",
        recipient: "bob",
        content: "Msg 2",
        summary: "Second",
      });

      const undelivered = messageService.getUndelivered("test-team", "bob");
      expect(undelivered).toHaveLength(2);
    });

    it("markDelivered removes from undelivered list", () => {
      const msg = messageService.send({
        teamName: "test-team",
        sender: "alice",
        recipient: "bob",
        content: "Msg",
        summary: "Test",
      });
      messageService.markDelivered(msg.id);

      const undelivered = messageService.getUndelivered("test-team", "bob");
      expect(undelivered).toHaveLength(0);
    });
  });
});
