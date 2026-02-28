import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  generateHookScripts,
  installHooks,
  mergeHooksConfig,
} from "./claude-code";
import type { ResolvedTemplate } from "../template/types";

function createMinimalTemplate(name: string): ResolvedTemplate {
  return {
    manifest: {
      name,
      version: "1.0.0",
      roles: ["lead", "worker", "reviewer"],
      topology: {
        root: { role: "lead" },
        companions: [{ role: "worker" }],
        spawn_rules: {
          lead: ["worker", "reviewer"],
          worker: [],
          reviewer: [],
        },
      },
      communication: {
        enforcement: "permissive",
        channels: {
          lifecycle: {
            signals: ["teammate_idle", "task_completed"],
            description: "Agent lifecycle events",
          },
          work: {
            signals: ["task_started", "task_blocked"],
            description: "Work coordination",
          },
        },
        subscriptions: {
          lead: [
            { channel: "lifecycle", signals: ["teammate_idle", "task_completed"] },
            { channel: "work" },
          ],
          worker: [
            { channel: "work", signals: ["task_started"] },
          ],
        },
        emissions: {
          lead: ["task_started"],
          worker: ["task_completed", "task_blocked"],
        },
      },
    },
    roles: new Map([
      ["lead", {
        name: "lead",
        displayName: "Team Lead",
        description: "Coordinates the team",
        capabilities: ["planning", "review"],
        raw: {} as any,
      }],
      ["worker", {
        name: "worker",
        displayName: "Worker",
        description: "Implements tasks",
        capabilities: ["coding"],
        raw: {} as any,
      }],
      ["reviewer", {
        name: "reviewer",
        displayName: "Reviewer",
        description: "Reviews work",
        capabilities: ["review"],
        raw: {} as any,
      }],
    ]),
    prompts: new Map(),
    mcpServers: new Map(),
    sourcePath: "/tmp/test-template",
  };
}

describe("Claude Code Hooks", () => {
  describe("generateHookScripts", () => {
    it("generates hook config with TeammateIdle and TaskCompleted entries", () => {
      const template = createMinimalTemplate("my-team");
      const result = generateHookScripts(template);

      expect(result.hooksConfig.hooks.TeammateIdle).toHaveLength(1);
      expect(result.hooksConfig.hooks.TaskCompleted).toHaveLength(1);
      expect(result.hooksConfig.hooks.TeammateIdle![0].type).toBe("command");
      expect(result.hooksConfig.hooks.TaskCompleted![0].type).toBe("command");
    });

    it("generates two script paths", () => {
      const template = createMinimalTemplate("my-team");
      const result = generateHookScripts(template);

      expect(result.scriptPaths).toHaveLength(2);
      expect(result.scriptPaths[0]).toContain("on-teammate-idle.sh");
      expect(result.scriptPaths[1]).toContain("on-task-completed.sh");
    });

    it("respects custom output directory", () => {
      const template = createMinimalTemplate("my-team");
      const result = generateHookScripts(template, {
        outputDir: "/custom/hooks",
      });

      expect(result.scriptPaths[0]).toBe("/custom/hooks/on-teammate-idle.sh");
      expect(result.scriptPaths[1]).toBe("/custom/hooks/on-task-completed.sh");
    });

    it("uses custom team name", () => {
      const template = createMinimalTemplate("my-team");
      const result = generateHookScripts(template, {
        teamName: "custom-name",
      });

      // The hook config commands should reference the scripts
      expect(result.hooksConfig.hooks.TeammateIdle![0].command).toContain(
        "on-teammate-idle.sh"
      );
    });
  });

  describe("installHooks", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-hooks-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes hook scripts to disk", () => {
      const template = createMinimalTemplate("my-team");
      const hooksDir = path.join(tmpDir, ".claude", "hooks");
      const result = installHooks(template, { outputDir: hooksDir });

      for (const scriptPath of result.scriptPaths) {
        expect(fs.existsSync(scriptPath)).toBe(true);
        const content = fs.readFileSync(scriptPath, "utf-8");
        expect(content).toContain("#!/usr/bin/env bash");
        expect(content).toContain("my-team");
      }
    });

    it("makes scripts executable", () => {
      const template = createMinimalTemplate("my-team");
      const hooksDir = path.join(tmpDir, ".claude", "hooks");
      const result = installHooks(template, { outputDir: hooksDir });

      for (const scriptPath of result.scriptPaths) {
        const stats = fs.statSync(scriptPath);
        // Check owner execute bit
        expect(stats.mode & 0o100).toBeTruthy();
      }
    });

    it("writes hooks.json config", () => {
      const template = createMinimalTemplate("my-team");
      const hooksDir = path.join(tmpDir, ".claude", "hooks");
      installHooks(template, { outputDir: hooksDir });

      const hooksJsonPath = path.join(tmpDir, ".claude", "hooks.json");
      expect(fs.existsSync(hooksJsonPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
      expect(config.hooks.TeammateIdle).toHaveLength(1);
      expect(config.hooks.TaskCompleted).toHaveLength(1);
    });

    it("merges into existing hooks.json without duplicates", () => {
      const template = createMinimalTemplate("my-team");
      const hooksDir = path.join(tmpDir, ".claude", "hooks");

      // Install once
      installHooks(template, { outputDir: hooksDir });
      // Install again — should not duplicate
      installHooks(template, { outputDir: hooksDir });

      const hooksJsonPath = path.join(tmpDir, ".claude", "hooks.json");
      const config = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
      expect(config.hooks.TeammateIdle).toHaveLength(1);
      expect(config.hooks.TaskCompleted).toHaveLength(1);
    });

    it("preserves existing hooks when merging", () => {
      const template = createMinimalTemplate("my-team");
      const hooksDir = path.join(tmpDir, ".claude", "hooks");
      fs.mkdirSync(hooksDir, { recursive: true });

      // Write existing config with a custom hook
      const hooksJsonPath = path.join(tmpDir, ".claude", "hooks.json");
      fs.writeFileSync(
        hooksJsonPath,
        JSON.stringify({
          hooks: {
            TeammateIdle: [
              { type: "command", command: "existing-hook.sh" },
            ],
          },
        }),
        "utf-8"
      );

      installHooks(template, { outputDir: hooksDir });

      const config = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
      expect(config.hooks.TeammateIdle).toHaveLength(2);
      expect(config.hooks.TeammateIdle[0].command).toBe("existing-hook.sh");
    });

    it("includes team name in generated scripts", () => {
      const template = createMinimalTemplate("cool-project");
      const hooksDir = path.join(tmpDir, ".claude", "hooks");
      const result = installHooks(template, { outputDir: hooksDir });

      const idleScript = fs.readFileSync(result.scriptPaths[0], "utf-8");
      expect(idleScript).toContain("cool-project");

      const taskScript = fs.readFileSync(result.scriptPaths[1], "utf-8");
      expect(taskScript).toContain("cool-project");
    });
  });

  describe("mergeHooksConfig", () => {
    it("creates hooks key if not present", () => {
      const result = mergeHooksConfig({}, {
        hooks: {
          TeammateIdle: [{ type: "command", command: "test.sh" }],
        },
      });
      expect(result.hooks.TeammateIdle).toHaveLength(1);
    });

    it("appends to existing event entries", () => {
      const result = mergeHooksConfig(
        {
          hooks: {
            TeammateIdle: [{ type: "command", command: "existing.sh" }],
          },
        },
        {
          hooks: {
            TeammateIdle: [{ type: "command", command: "new.sh" }],
          },
        }
      );
      expect(result.hooks.TeammateIdle).toHaveLength(2);
    });

    it("skips duplicate commands", () => {
      const result = mergeHooksConfig(
        {
          hooks: {
            TeammateIdle: [{ type: "command", command: "same.sh" }],
          },
        },
        {
          hooks: {
            TeammateIdle: [{ type: "command", command: "same.sh" }],
          },
        }
      );
      expect(result.hooks.TeammateIdle).toHaveLength(1);
    });

    it("preserves unrelated keys in existing config", () => {
      const result = mergeHooksConfig(
        { hooks: {}, customKey: "preserved" },
        { hooks: { TeammateIdle: [{ type: "command", command: "test.sh" }] } }
      );
      expect(result.customKey).toBe("preserved");
    });
  });
});
