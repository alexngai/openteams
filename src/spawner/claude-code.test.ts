import { describe, it, expect } from "vitest";
import { ClaudeCodeSpawner } from "./claude-code";

describe("ClaudeCodeSpawner", () => {
  it("implements AgentSpawner interface", () => {
    const spawner = new ClaudeCodeSpawner();
    expect(spawner.spawn).toBeDefined();
    expect(spawner.shutdown).toBeDefined();
    expect(spawner.list).toBeDefined();
  });

  it("accepts options", () => {
    const spawner = new ClaudeCodeSpawner({
      claudePath: "/usr/local/bin/claude",
      teammateMode: "tmux",
    });
    expect(spawner).toBeDefined();
  });

  it("defaults to in-process teammate mode", () => {
    const spawner = new ClaudeCodeSpawner();
    expect(spawner).toBeDefined();
  });

  describe("spawn", () => {
    it("creates an agent instance with correct id prefix and name", async () => {
      const spawner = new ClaudeCodeSpawner();
      const instance = await spawner.spawn({
        name: "researcher",
        teamName: "test-team",
        prompt: "Research the codebase",
      });

      expect(instance.id).toMatch(/^cc-/);
      expect(instance.name).toBe("researcher");
      expect(instance.isRunning()).toBe(false);
    });

    it("tracks spawned agents in list()", async () => {
      const spawner = new ClaudeCodeSpawner();
      expect(spawner.list()).toHaveLength(0);

      await spawner.spawn({
        name: "a",
        teamName: "test-team",
        prompt: "Work A",
      });
      expect(spawner.list()).toHaveLength(1);

      await spawner.spawn({
        name: "b",
        teamName: "test-team",
        prompt: "Work B",
      });
      expect(spawner.list()).toHaveLength(2);
    });
  });

  describe("shutdown", () => {
    it("removes agent from list", async () => {
      const spawner = new ClaudeCodeSpawner();
      const instance = await spawner.spawn({
        name: "worker",
        teamName: "test-team",
        prompt: "Work",
      });

      expect(spawner.list()).toHaveLength(1);
      await spawner.shutdown(instance.id);
      expect(spawner.list()).toHaveLength(0);
    });

    it("handles shutdown of nonexistent agent gracefully", async () => {
      const spawner = new ClaudeCodeSpawner();
      await expect(spawner.shutdown("nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all tracked agents", async () => {
      const spawner = new ClaudeCodeSpawner();

      await spawner.spawn({
        name: "a",
        teamName: "test",
        prompt: "A",
      });
      await spawner.spawn({
        name: "b",
        teamName: "test",
        prompt: "B",
      });

      const agents = spawner.list();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.name)).toContain("a");
      expect(agents.map((a) => a.name)).toContain("b");
    });
  });
});
