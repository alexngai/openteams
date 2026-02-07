import { describe, it, expect, beforeEach } from "vitest";
import { MockSpawner } from "./mock";

describe("MockSpawner", () => {
  let spawner: MockSpawner;

  beforeEach(() => {
    spawner = new MockSpawner();
  });

  it("spawns a mock agent", async () => {
    const instance = await spawner.spawn({
      name: "test-agent",
      teamName: "test-team",
      prompt: "Do testing",
    });

    expect(instance.id).toMatch(/^mock-/);
    expect(instance.name).toBe("test-agent");
    expect(instance.isRunning()).toBe(true);
  });

  it("records spawn calls", async () => {
    await spawner.spawn({
      name: "a",
      teamName: "team",
      prompt: "Prompt A",
    });
    await spawner.spawn({
      name: "b",
      teamName: "team",
      prompt: "Prompt B",
    });

    expect(spawner.spawnCalls).toHaveLength(2);
    expect(spawner.spawnCalls[0].name).toBe("a");
    expect(spawner.spawnCalls[1].name).toBe("b");
  });

  it("sends mock prompt responses", async () => {
    const instance = await spawner.spawn({
      name: "test",
      teamName: "team",
      prompt: "Init",
    });

    const updates = [];
    for await (const update of instance.sendPrompt("Hello")) {
      updates.push(update);
    }

    expect(updates).toHaveLength(2);
    expect(updates[0].type).toBe("text");
    expect(updates[0].content).toContain("Hello");
    expect(updates[1].type).toBe("done");
  });

  it("shuts down an agent", async () => {
    const instance = await spawner.spawn({
      name: "test",
      teamName: "team",
      prompt: "Init",
    });

    await spawner.shutdown(instance.id);
    expect(instance.isRunning()).toBe(false);
    expect(spawner.shutdownCalls).toEqual([instance.id]);
  });

  it("lists active agents", async () => {
    await spawner.spawn({ name: "a", teamName: "t", prompt: "P" });
    await spawner.spawn({ name: "b", teamName: "t", prompt: "P" });

    expect(spawner.list()).toHaveLength(2);
  });

  it("removes agent from list on shutdown", async () => {
    const a = await spawner.spawn({ name: "a", teamName: "t", prompt: "P" });
    await spawner.spawn({ name: "b", teamName: "t", prompt: "P" });

    await spawner.shutdown(a.id);
    expect(spawner.list()).toHaveLength(1);
  });

  it("resets all state", async () => {
    await spawner.spawn({ name: "a", teamName: "t", prompt: "P" });
    spawner.reset();

    expect(spawner.list()).toHaveLength(0);
    expect(spawner.spawnCalls).toHaveLength(0);
    expect(spawner.shutdownCalls).toHaveLength(0);
  });
});
