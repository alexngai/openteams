import { describe, it, expect } from "vitest";
import { MemberRegistry } from "./member-registry";
import type { ResolvedTemplate } from "../template/types";

function makeTemplate(overrides?: Partial<ResolvedTemplate["manifest"]>): ResolvedTemplate {
  return {
    manifest: {
      name: "test-team",
      version: 1,
      roles: ["architect", "executor", "researcher"],
      topology: {
        root: { role: "architect" },
        companions: [{ role: "executor" }, { role: "researcher" }],
        spawn_rules: {
          architect: [{ role: "researcher", max_instances: 3 }],
        },
      },
      ...overrides,
    },
    roles: new Map(),
    prompts: new Map(),
    mcpServers: new Map(),
    sourcePath: "/tmp/test",
  };
}

describe("MemberRegistry", () => {
  it("registers and looks up by agentId", () => {
    const reg = new MemberRegistry(makeTemplate());
    const id = reg.register("architect", "agent-1");
    expect(id.role).toBe("architect");
    expect(id.agentId).toBe("agent-1");
    expect(reg.byAgentId("agent-1")).toBe(id);
  });

  it("registers and looks up by label", () => {
    const reg = new MemberRegistry(makeTemplate());
    const id = reg.register("architect", "agent-1", "chief-architect");
    expect(id.label).toBe("chief-architect");
    expect(reg.byLabel("chief-architect")).toBe(id);
  });

  it("auto-generates labels", () => {
    const reg = new MemberRegistry(makeTemplate());
    const first = reg.register("researcher", "r1");
    expect(first.label).toBe("researcher");
    const second = reg.register("researcher", "r2");
    expect(second.label).toBe("researcher-2");
    const third = reg.register("researcher", "r3");
    expect(third.label).toBe("researcher-3");
  });

  it("looks up all members with a role", () => {
    const reg = new MemberRegistry(makeTemplate());
    reg.register("researcher", "r1");
    reg.register("researcher", "r2");
    reg.register("architect", "a1");
    expect(reg.byRole("researcher")).toHaveLength(2);
    expect(reg.byRole("architect")).toHaveLength(1);
    expect(reg.byRole("executor")).toHaveLength(0);
  });

  it("rejects unknown roles", () => {
    const reg = new MemberRegistry(makeTemplate());
    expect(() => reg.register("unknown-role", "agent-1")).toThrow(/Unknown role/);
  });

  it("rejects duplicate agent IDs", () => {
    const reg = new MemberRegistry(makeTemplate());
    reg.register("architect", "agent-1");
    expect(() => reg.register("executor", "agent-1")).toThrow(/already registered/);
  });

  it("rejects duplicate labels", () => {
    const reg = new MemberRegistry(makeTemplate());
    reg.register("architect", "a1", "my-label");
    expect(() => reg.register("executor", "e1", "my-label")).toThrow(/already in use/);
  });

  it("enforces max_instances from spawn rules", () => {
    const reg = new MemberRegistry(makeTemplate());
    reg.register("researcher", "r1");
    reg.register("researcher", "r2");
    reg.register("researcher", "r3");
    expect(() => reg.register("researcher", "r4")).toThrow(/max_instances/);
  });

  it("unregisters members", () => {
    const reg = new MemberRegistry(makeTemplate());
    reg.register("architect", "a1");
    expect(reg.has("a1")).toBe(true);
    const removed = reg.unregister("a1");
    expect(removed?.agentId).toBe("a1");
    expect(reg.has("a1")).toBe(false);
    expect(reg.byLabel("architect")).toBeUndefined();
  });

  it("returns undefined when unregistering unknown agentId", () => {
    const reg = new MemberRegistry(makeTemplate());
    expect(reg.unregister("nonexistent")).toBeUndefined();
  });

  it("allows re-registering a role after unregister", () => {
    const reg = new MemberRegistry(makeTemplate());
    reg.register("researcher", "r1");
    reg.register("researcher", "r2");
    reg.register("researcher", "r3");
    reg.unregister("r2");
    // Should succeed — slot freed
    const id = reg.register("researcher", "r4");
    expect(id.role).toBe("researcher");
  });

  it("reports size and all()", () => {
    const reg = new MemberRegistry(makeTemplate());
    expect(reg.size).toBe(0);
    reg.register("architect", "a1");
    reg.register("executor", "e1");
    expect(reg.size).toBe(2);
    expect(reg.all()).toHaveLength(2);
  });
});
