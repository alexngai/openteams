import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import yaml from "js-yaml";
import type Database from "better-sqlite3";
import type { Command } from "commander";
import { createInMemoryDatabase } from "../db/database";
import { createTemplateCommands } from "./template";

// --- Helpers ---

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openteams-e2e-"));
}

function writeMinimalTemplate(dir: string, name: string): void {
  const templateDir = path.join(dir, name);
  fs.mkdirSync(path.join(templateDir, "roles"), { recursive: true });
  fs.mkdirSync(path.join(templateDir, "prompts"), { recursive: true });

  fs.writeFileSync(
    path.join(templateDir, "team.yaml"),
    yaml.dump({
      name,
      description: `Test template ${name}`,
      version: 1,
      roles: ["lead"],
      topology: { root: { role: "lead" } },
    })
  );
  fs.writeFileSync(
    path.join(templateDir, "roles", "lead.yaml"),
    yaml.dump({ display_name: "Lead", description: "The team lead" })
  );
  fs.writeFileSync(
    path.join(templateDir, "prompts", "lead.md"),
    "You are the lead."
  );
}

function writeMultiRoleTemplate(dir: string, name: string): void {
  const templateDir = path.join(dir, name);
  fs.mkdirSync(path.join(templateDir, "roles"), { recursive: true });
  fs.mkdirSync(path.join(templateDir, "prompts", "planner"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(templateDir, "prompts", "executor"), {
    recursive: true,
  });

  fs.writeFileSync(
    path.join(templateDir, "team.yaml"),
    yaml.dump({
      name,
      description: `Multi-role template ${name}`,
      version: 2,
      roles: ["planner", "executor"],
      topology: {
        root: { role: "planner" },
        companions: [{ role: "executor" }],
      },
    })
  );
  fs.writeFileSync(
    path.join(templateDir, "roles", "planner.yaml"),
    yaml.dump({ display_name: "Planner", description: "Plans the work" })
  );
  fs.writeFileSync(
    path.join(templateDir, "roles", "executor.yaml"),
    yaml.dump({ display_name: "Executor", description: "Does the work" })
  );
  fs.writeFileSync(
    path.join(templateDir, "prompts", "planner", "ROLE.md"),
    "You plan the work."
  );
  fs.writeFileSync(
    path.join(templateDir, "prompts", "executor", "ROLE.md"),
    "You execute the plan."
  );
}

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(
    'git -c user.name="Test" -c user.email="test@test.com" commit -m "init"',
    { cwd: dir, stdio: "pipe" }
  );
}

// --- Tests ---

describe("CLI: template install (e2e)", () => {
  let db: Database.Database;
  let templateCmd: Command;
  let tmpDirs: string[];
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    db = createInMemoryDatabase();
    templateCmd = createTemplateCommands(db);
    tmpDirs = [];
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
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function track(dir: string): string {
    tmpDirs.push(dir);
    return dir;
  }

  async function run(cmd: Command, args: string[]) {
    cmd.exitOverride();
    try {
      await cmd.parseAsync(["node", "test", ...args]);
    } catch {
      // commander may throw on --help or missing required options
    }
  }

  // --- Single template install ---

  it("installs a single template from a git repo", async () => {
    const sourceDir = track(makeTmpDir());
    writeMinimalTemplate(sourceDir, "my-team");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      sourceDir,
      "my-team",
      "--output",
      outputDir,
    ]);

    const output = logs.join("\n");
    expect(output).toContain('Template "my-team" installed.');
    expect(output).toContain(`Location: ${outputDir}`);

    // Verify template files were copied
    expect(fs.existsSync(path.join(outputDir, "team.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "roles", "lead.yaml"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(outputDir, "prompts", "lead.md"))).toBe(
      true
    );

    // Verify team.yaml content is valid
    const manifest = yaml.load(
      fs.readFileSync(path.join(outputDir, "team.yaml"), "utf-8")
    ) as any;
    expect(manifest.name).toBe("my-team");
    expect(manifest.version).toBe(1);
    expect(manifest.roles).toEqual(["lead"]);
  });

  // --- Multi-role template with nested prompts ---

  it("installs a multi-role template with nested prompt directories", async () => {
    const sourceDir = track(makeTmpDir());
    writeMultiRoleTemplate(sourceDir, "complex-team");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      sourceDir,
      "complex-team",
      "--output",
      outputDir,
    ]);

    expect(logs.join("\n")).toContain('Template "complex-team" installed.');

    // Verify nested prompt directories were copied
    expect(
      fs.existsSync(path.join(outputDir, "prompts", "planner", "ROLE.md"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(outputDir, "prompts", "executor", "ROLE.md"))
    ).toBe(true);

    // Verify role files
    expect(
      fs.existsSync(path.join(outputDir, "roles", "planner.yaml"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(outputDir, "roles", "executor.yaml"))
    ).toBe(true);
  });

  // --- Template selection by name ---

  it("selects the correct template when repo has multiple", async () => {
    const sourceDir = track(makeTmpDir());
    writeMinimalTemplate(sourceDir, "alpha");
    writeMultiRoleTemplate(sourceDir, "beta");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      sourceDir,
      "beta",
      "--output",
      outputDir,
    ]);

    expect(logs.join("\n")).toContain('Template "beta" installed.');

    // Verify it installed beta, not alpha
    const manifest = yaml.load(
      fs.readFileSync(path.join(outputDir, "team.yaml"), "utf-8")
    ) as any;
    expect(manifest.name).toBe("beta");
    expect(manifest.roles).toEqual(["planner", "executor"]);
  });

  // --- Metadata file ---

  it("writes .openteams-install.json with provenance metadata", async () => {
    const sourceDir = track(makeTmpDir());
    writeMinimalTemplate(sourceDir, "tracked");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      sourceDir,
      "tracked",
      "--output",
      outputDir,
    ]);

    const metaPath = path.join(outputDir, ".openteams-install.json");
    expect(fs.existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    expect(meta.sourceRepo).toBe(sourceDir);
    expect(meta.templateName).toBe("tracked");
    expect(meta.version).toBe(1);
    expect(meta.installedAt).toBeTruthy();
  });

  // --- .git directory is excluded ---

  it("does not copy .git directory from source", async () => {
    const sourceDir = track(makeTmpDir());
    writeMinimalTemplate(sourceDir, "clean");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      sourceDir,
      "clean",
      "--output",
      outputDir,
    ]);

    expect(fs.existsSync(path.join(outputDir, ".git"))).toBe(false);
  });

  // --- Overwrites existing installation ---

  it("overwrites an existing installation at the target", async () => {
    const sourceDir = track(makeTmpDir());
    writeMinimalTemplate(sourceDir, "overwrite-me");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    // First install
    await run(templateCmd, [
      "install",
      sourceDir,
      "overwrite-me",
      "--output",
      outputDir,
    ]);
    expect(fs.existsSync(path.join(outputDir, "team.yaml"))).toBe(true);

    // Add a stale file to the installed dir
    fs.writeFileSync(path.join(outputDir, "stale-file.txt"), "old stuff");

    logs = [];

    // Second install — should overwrite
    await run(templateCmd, [
      "install",
      sourceDir,
      "overwrite-me",
      "--output",
      outputDir,
    ]);

    expect(logs.join("\n")).toContain('Template "overwrite-me" installed.');
    // Stale file should be gone (directory was replaced)
    expect(fs.existsSync(path.join(outputDir, "stale-file.txt"))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, "team.yaml"))).toBe(true);
  });

  // --- Error: no templates in repo ---

  it("errors when repo contains no templates", async () => {
    const sourceDir = track(makeTmpDir());
    fs.writeFileSync(path.join(sourceDir, "README.md"), "nothing here");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      sourceDir,
      "--output",
      outputDir,
    ]);

    expect(errors.join("\n")).toContain("No team templates found in repository");
    expect(process.exitCode).toBe(1);
  });

  // --- Error: template name not found ---

  it("errors when specified template name does not exist in repo", async () => {
    const sourceDir = track(makeTmpDir());
    writeMinimalTemplate(sourceDir, "real-team");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      sourceDir,
      "nonexistent",
      "--output",
      outputDir,
    ]);

    expect(errors.join("\n")).toContain(
      'Template "nonexistent" not found. Available: real-team'
    );
    expect(process.exitCode).toBe(1);
  });

  // --- Error: invalid git repo URL ---

  it("errors when git clone fails", async () => {
    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      "/nonexistent/path/to/repo",
      "--output",
      outputDir,
    ]);

    expect(errors.join("\n")).toContain("Failed to clone");
    expect(process.exitCode).toBe(1);
  });

  // --- Validates installed template ---

  it("validates the template after installation", async () => {
    const sourceDir = track(makeTmpDir());

    // Create a template with an invalid manifest (bad topology reference)
    const templateDir = path.join(sourceDir, "bad-team");
    fs.mkdirSync(path.join(templateDir, "roles"), { recursive: true });
    fs.writeFileSync(
      path.join(templateDir, "team.yaml"),
      yaml.dump({
        name: "bad-team",
        version: 1,
        roles: ["lead"],
        topology: { root: { role: "nonexistent-role" } },
      })
    );
    fs.writeFileSync(
      path.join(templateDir, "roles", "lead.yaml"),
      yaml.dump({ display_name: "Lead" })
    );
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    await run(templateCmd, [
      "install",
      sourceDir,
      "bad-team",
      "--output",
      outputDir,
    ]);

    // Should fail validation
    expect(errors.join("\n")).toContain("Error:");
    expect(process.exitCode).toBe(1);
  });

  // --- Cleans up temp directory on success ---

  it("cleans up the cloned temp directory after install", async () => {
    const sourceDir = track(makeTmpDir());
    writeMinimalTemplate(sourceDir, "cleanup-test");
    initGitRepo(sourceDir);

    const outputDir = path.join(track(makeTmpDir()), "installed");

    // Count temp dirs before
    const tmpBase = os.tmpdir();
    const beforeDirs = fs
      .readdirSync(tmpBase)
      .filter((d) => d.startsWith("openteams-install-"));

    await run(templateCmd, [
      "install",
      sourceDir,
      "cleanup-test",
      "--output",
      outputDir,
    ]);

    // Count temp dirs after — should not have grown
    const afterDirs = fs
      .readdirSync(tmpBase)
      .filter((d) => d.startsWith("openteams-install-"));
    expect(afterDirs.length).toBe(beforeDirs.length);
  });

  // --- Cleans up temp directory on failure ---

  it("cleans up the cloned temp directory on failure", async () => {
    const sourceDir = track(makeTmpDir());
    fs.writeFileSync(path.join(sourceDir, "README.md"), "no templates");
    initGitRepo(sourceDir);

    const tmpBase = os.tmpdir();
    const beforeDirs = fs
      .readdirSync(tmpBase)
      .filter((d) => d.startsWith("openteams-install-"));

    await run(templateCmd, [
      "install",
      sourceDir,
      "--output",
      track(makeTmpDir()),
    ]);

    const afterDirs = fs
      .readdirSync(tmpBase)
      .filter((d) => d.startsWith("openteams-install-"));
    expect(afterDirs.length).toBe(beforeDirs.length);
  });
});
