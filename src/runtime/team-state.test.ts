import { describe, it, expect, vi } from "vitest";
import { TeamState } from "./team-state";
import type { ResolvedTemplate, CommunicationConfig } from "../template/types";
import type { TeamEvent, StateChangeEvent } from "./types";

function makeTemplate(comm?: CommunicationConfig): ResolvedTemplate {
  return {
    manifest: {
      name: "test-team",
      version: 1,
      roles: ["architect", "executor", "researcher"],
      topology: {
        root: { role: "architect" },
        companions: [{ role: "executor" }, { role: "researcher" }],
      },
      communication: comm,
    },
    roles: new Map(),
    prompts: new Map(),
    mcpServers: new Map(),
    sourcePath: "/tmp/test",
  };
}

function registerAgent(state: TeamState, role: string, agentId: string, label?: string): void {
  state.applyEvent({
    type: "agent_registered",
    role,
    agentId,
    label: label ?? role,
    timestamp: 1000,
  });
}

describe("TeamState", () => {
  describe("agent_registered", () => {
    it("adds a member with registered status", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "architect", "a1");
      const member = ts.getMember("a1");
      expect(member).toBeDefined();
      expect(member!.status).toBe("registered");
      expect(member!.identity.role).toBe("architect");
    });

    it("makes member accessible by label", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "architect", "a1", "chief");
      expect(ts.getMemberByLabel("chief")).toBeDefined();
      expect(ts.getMemberByLabel("chief")!.identity.agentId).toBe("a1");
    });

    it("stores metadata from registration", () => {
      const ts = new TeamState("test", makeTemplate());
      ts.applyEvent({
        type: "agent_registered",
        role: "architect",
        agentId: "a1",
        label: "architect",
        metadata: { model: "opus" },
        timestamp: 1000,
      });
      expect(ts.getMember("a1")!.metadata).toEqual({ model: "opus" });
    });
  });

  describe("agent_state_changed", () => {
    it("transitions registered → idle", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "architect", "a1");
      ts.applyEvent({
        type: "agent_state_changed",
        agentId: "a1",
        status: "idle",
        timestamp: 2000,
      });
      expect(ts.getMember("a1")!.status).toBe("idle");
      expect(ts.getMember("a1")!.lastActivity).toBe(2000);
    });

    it("transitions idle → busy", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "executor", "e1");
      ts.applyEvent({ type: "agent_state_changed", agentId: "e1", status: "idle" });
      ts.applyEvent({ type: "agent_state_changed", agentId: "e1", status: "busy", executionStatus: "tool_use" });
      const m = ts.getMember("e1")!;
      expect(m.status).toBe("busy");
      expect(m.executionStatus).toBe("tool_use");
    });

    it("rejects invalid transitions", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "architect", "a1");
      // registered → busy is valid, but stopped → idle is not
      ts.applyEvent({ type: "agent_state_changed", agentId: "a1", status: "stopped" });
      expect(() => {
        ts.applyEvent({ type: "agent_state_changed", agentId: "a1", status: "idle" });
      }).toThrow(/Invalid status transition/);
    });

    it("rejects events for unknown agent IDs", () => {
      const ts = new TeamState("test", makeTemplate());
      expect(() => {
        ts.applyEvent({ type: "agent_state_changed", agentId: "ghost", status: "idle" });
      }).toThrow(/No member/);
    });

    it("merges metadata on state change", () => {
      const ts = new TeamState("test", makeTemplate());
      ts.applyEvent({
        type: "agent_registered",
        role: "architect",
        agentId: "a1",
        label: "architect",
        metadata: { model: "opus" },
      });
      ts.applyEvent({
        type: "agent_state_changed",
        agentId: "a1",
        status: "idle",
        metadata: { task: "planning" },
      });
      expect(ts.getMember("a1")!.metadata).toEqual({ model: "opus", task: "planning" });
    });

    it("sets error on error status", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "executor", "e1");
      ts.applyEvent({
        type: "agent_state_changed",
        agentId: "e1",
        status: "error",
        error: "tool crashed",
      });
      expect(ts.getMember("e1")!.error).toBe("tool crashed");
    });
  });

  describe("agent_unregistered", () => {
    it("removes member and sets stopped status in event", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "architect", "a1");
      const events: StateChangeEvent[] = [];
      ts.onStateChange((e) => events.push(e));

      ts.applyEvent({ type: "agent_unregistered", agentId: "a1", reason: "done" });

      expect(ts.getMember("a1")).toBeUndefined();
      expect(events[0].member.status).toBe("stopped");
      expect(events[0].previous!.status).toBe("registered");
    });

    it("rejects unregister for unknown agent", () => {
      const ts = new TeamState("test", makeTemplate());
      expect(() => {
        ts.applyEvent({ type: "agent_unregistered", agentId: "ghost" });
      }).toThrow(/No member/);
    });
  });

  describe("onStateChange", () => {
    it("fires for each event", () => {
      const ts = new TeamState("test", makeTemplate());
      const events: StateChangeEvent[] = [];
      ts.onStateChange((e) => events.push(e));

      registerAgent(ts, "architect", "a1");
      ts.applyEvent({ type: "agent_state_changed", agentId: "a1", status: "idle" });

      expect(events).toHaveLength(2);
      expect(events[0].event.type).toBe("agent_registered");
      expect(events[0].previous).toBeUndefined();
      expect(events[1].event.type).toBe("agent_state_changed");
      expect(events[1].previous!.status).toBe("registered");
    });

    it("returns unsubscribe function", () => {
      const ts = new TeamState("test", makeTemplate());
      const listener = vi.fn();
      const unsub = ts.onStateChange(listener);

      registerAgent(ts, "architect", "a1");
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      ts.applyEvent({ type: "agent_state_changed", agentId: "a1", status: "idle" });
      expect(listener).toHaveBeenCalledTimes(1); // not called again
    });
  });

  describe("getMembers", () => {
    it("returns all active members", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "architect", "a1");
      registerAgent(ts, "executor", "e1");
      expect(ts.getMembers()).toHaveLength(2);
    });
  });

  describe("validateMessageByLabel", () => {
    it("resolves labels and validates", () => {
      const comm: CommunicationConfig = {
        routing: { peers: [] },
      };
      const ts = new TeamState("test", makeTemplate(comm));
      registerAgent(ts, "architect", "a1", "arch");
      registerAgent(ts, "executor", "e1", "exec");

      const result = ts.validateMessageByLabel("arch", "exec");
      expect(result.valid).toBe(true); // root ↔ companion implicit route
    });

    it("fails for unknown labels", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "architect", "a1", "arch");

      const result = ts.validateMessageByLabel("arch", "nobody");
      expect(result.valid).toBe(false);
      expect(result.violations[0].message).toMatch(/Unknown receiver/);
    });
  });

  describe("snapshot", () => {
    it("returns serializable snapshot", () => {
      const ts = new TeamState("test", makeTemplate());
      registerAgent(ts, "architect", "a1");
      registerAgent(ts, "executor", "e1");
      registerAgent(ts, "executor", "e2", "executor-2");

      const snap = ts.snapshot();
      expect(snap.teamName).toBe("test");
      expect(snap.members).toHaveLength(3);
      expect(snap.roleCounts).toEqual({ architect: 1, executor: 2 });
      expect(typeof snap.timestamp).toBe("number");

      // Verify it's serializable
      const json = JSON.stringify(snap);
      expect(JSON.parse(json)).toEqual(snap);
    });
  });
});
