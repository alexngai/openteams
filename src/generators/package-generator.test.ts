import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { TemplateLoader } from "../template/loader";
import { generatePackage } from "./package-generator";
import type { TeamManifest, ResolvedTemplate } from "../template/types";

function makeFullTemplate(): ResolvedTemplate {
  const manifest: TeamManifest = {
    name: "self-driving",
    description: "Autonomous codebase development",
    version: 1,
    roles: ["planner", "grinder", "judge"],
    topology: {
      root: {
        role: "planner",
        config: { model: "sonnet" },
      },
      companions: [{ role: "judge" }],
      spawn_rules: {
        planner: ["grinder", "planner"],
        judge: [],
        grinder: [],
      },
    },
    communication: {
      channels: {
        task_updates: {
          description: "Task lifecycle events",
          signals: ["TASK_CREATED", "TASK_COMPLETED", "TASK_FAILED"],
        },
      },
      subscriptions: {
        planner: [{ channel: "task_updates" }],
      },
      emissions: {
        planner: ["TASK_CREATED"],
      },
    },
  };
  return TemplateLoader.loadFromManifest(manifest);
}

describe("generatePackage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-pkg-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the output directory", () => {
    const outputDir = path.join(tmpDir, "output");
    generatePackage(makeFullTemplate(), { outputDir });
    expect(fs.existsSync(outputDir)).toBe(true);
  });

  it("generates a top-level SKILL.md catalog", () => {
    const outputDir = path.join(tmpDir, "output");
    const result = generatePackage(makeFullTemplate(), { outputDir });

    expect(result.catalogPath).toBe(path.join(outputDir, "SKILL.md"));
    expect(fs.existsSync(result.catalogPath)).toBe(true);

    const content = fs.readFileSync(result.catalogPath, "utf-8");
    expect(content).toContain("# Team: self-driving");
    expect(content).toContain("## Roles");
    expect(content).toContain("| planner |");
    expect(content).toContain("## Loading a role");
  });

  it("generates per-role SKILL.md files", () => {
    const outputDir = path.join(tmpDir, "output");
    const result = generatePackage(makeFullTemplate(), { outputDir });

    expect(result.rolePaths).toHaveLength(3);

    for (const rp of result.rolePaths) {
      expect(fs.existsSync(rp.path)).toBe(true);
      const content = fs.readFileSync(rp.path, "utf-8");
      expect(content).toMatch(/^---\n/);
      expect(content).toContain(`role: ${rp.role}`);
      expect(content).toContain(`# Role: ${rp.role}`);
    }
  });

  it("places role files in roles/<name>/SKILL.md", () => {
    const outputDir = path.join(tmpDir, "output");
    const result = generatePackage(makeFullTemplate(), { outputDir });

    const plannerPath = result.rolePaths.find(
      (r) => r.role === "planner"
    )!.path;
    expect(plannerPath).toBe(
      path.join(outputDir, "roles", "planner", "SKILL.md")
    );
  });

  it("respects team name override", () => {
    const outputDir = path.join(tmpDir, "output");
    generatePackage(makeFullTemplate(), {
      outputDir,
      teamName: "my-project",
    });

    const catalog = fs.readFileSync(
      path.join(outputDir, "SKILL.md"),
      "utf-8"
    );
    expect(catalog).toContain("# Team: my-project");

    const roleMd = fs.readFileSync(
      path.join(outputDir, "roles", "planner", "SKILL.md"),
      "utf-8"
    );
    expect(roleMd).toContain("team: my-project");
  });

  it("returns null manifestPath when no source exists", () => {
    const outputDir = path.join(tmpDir, "output");
    const result = generatePackage(makeFullTemplate(), { outputDir });
    // loadFromManifest sets sourcePath to "", so no team.yaml to copy
    expect(result.manifestPath).toBeNull();
  });
});
