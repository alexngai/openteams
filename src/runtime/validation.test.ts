import { describe, it, expect } from "vitest";
import { validateMessage } from "./validation";
import type { ResolvedTemplate, CommunicationConfig } from "../template/types";

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

describe("validateMessage", () => {
  it("rejects unknown sender role", () => {
    const result = validateMessage(makeTemplate(), "ghost", "architect");
    expect(result.valid).toBe(false);
    expect(result.violations[0].message).toMatch(/Sender role/);
    expect(result.violations[0].severity).toBe("error");
  });

  it("rejects unknown receiver role", () => {
    const result = validateMessage(makeTemplate(), "architect", "ghost");
    expect(result.valid).toBe(false);
    expect(result.violations[0].message).toMatch(/Receiver role/);
  });

  it("allows any message when no communication config", () => {
    const result = validateMessage(makeTemplate(), "architect", "executor");
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("allows root ↔ companion communication with peer routes", () => {
    const comm: CommunicationConfig = {
      routing: {
        peers: [], // no explicit peers, but root↔companion is implicit
      },
    };
    const result = validateMessage(makeTemplate(comm), "architect", "executor");
    expect(result.valid).toBe(true);
  });

  it("allows companion → root communication", () => {
    const comm: CommunicationConfig = {
      routing: { peers: [] },
    };
    const result = validateMessage(makeTemplate(comm), "executor", "architect");
    expect(result.valid).toBe(true);
  });

  it("warns on missing peer route (permissive enforcement)", () => {
    const comm: CommunicationConfig = {
      enforcement: "permissive",
      routing: {
        peers: [{ from: "architect", to: "executor", via: "direct" }],
      },
    };
    // executor → researcher has no route
    const result = validateMessage(makeTemplate(comm), "executor", "researcher");
    expect(result.valid).toBe(true); // warnings don't invalidate
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].severity).toBe("warning");
  });

  it("fails on missing peer route (strict enforcement)", () => {
    const comm: CommunicationConfig = {
      enforcement: "strict",
      routing: {
        peers: [{ from: "architect", to: "executor", via: "direct" }],
      },
    };
    const result = validateMessage(makeTemplate(comm), "executor", "researcher");
    expect(result.valid).toBe(false);
    expect(result.violations[0].severity).toBe("error");
  });

  it("allows explicit peer route", () => {
    const comm: CommunicationConfig = {
      enforcement: "strict",
      routing: {
        peers: [{ from: "executor", to: "researcher", via: "direct" }],
      },
    };
    const result = validateMessage(makeTemplate(comm), "executor", "researcher");
    expect(result.valid).toBe(true);
  });

  it("validates channel existence", () => {
    const comm: CommunicationConfig = {
      enforcement: "strict",
      channels: {
        status: { signals: ["progress", "done"] },
      },
    };
    const result = validateMessage(makeTemplate(comm), "architect", "executor", "nonexistent");
    expect(result.valid).toBe(false);
    expect(result.violations[0].message).toMatch(/not defined/);
  });

  it("validates signal existence in channel", () => {
    const comm: CommunicationConfig = {
      enforcement: "strict",
      channels: {
        status: { signals: ["progress", "done"] },
      },
    };
    const result = validateMessage(makeTemplate(comm), "architect", "executor", "status", "invalid-signal");
    expect(result.valid).toBe(false);
    expect(result.violations[0].message).toMatch(/Signal "invalid-signal"/);
  });

  it("validates emission rights", () => {
    const comm: CommunicationConfig = {
      enforcement: "strict",
      channels: {
        status: { signals: ["progress"] },
      },
      emissions: {
        executor: ["status"],
        // architect cannot emit to status
      },
    };
    const result = validateMessage(makeTemplate(comm), "architect", "executor", "status");
    expect(result.valid).toBe(false);
    expect(result.violations[0].message).toMatch(/cannot emit/);
  });

  it("validates subscription rights", () => {
    const comm: CommunicationConfig = {
      enforcement: "strict",
      channels: {
        status: { signals: ["progress", "done"] },
      },
      emissions: {
        architect: ["status"],
      },
      subscriptions: {
        executor: [{ channel: "status", signals: ["progress"] }],
      },
    };
    // executor subscribed to "progress" but not "done"
    const result = validateMessage(makeTemplate(comm), "architect", "executor", "status", "done");
    expect(result.valid).toBe(false);
    expect(result.violations[0].message).toMatch(/not subscribed to signal/);
  });

  it("allows valid channel+signal communication", () => {
    const comm: CommunicationConfig = {
      channels: {
        status: { signals: ["progress", "done"] },
      },
      emissions: {
        executor: ["status"],
      },
      subscriptions: {
        architect: [{ channel: "status" }], // subscribes to all signals
      },
    };
    const result = validateMessage(makeTemplate(comm), "executor", "architect", "status", "progress");
    expect(result.valid).toBe(true);
  });
});
