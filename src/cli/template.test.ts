/**
 * Acceptance tests for the `openteams template` CLI commands.
 * Runs the CLI as a subprocess to test end-to-end behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const CLI = path.resolve(__dirname, "../cli.ts");
const RUN = `npx tsx ${CLI}`;

function run(
  args: string,
  opts?: { cwd?: string }
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`${RUN} ${args}`, {
      encoding: "utf-8",
      cwd: opts?.cwd,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 15000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("openteams template CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relPath: string, content: string): void {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }

  function writeTeamYaml(dir: string, name: string): void {
    writeFile(
      path.join(dir, "team.yaml"),
      `name: ${name}\nversion: 1\nroles:\n  - worker\ntopology:\n  root:\n    role: worker\n`
    );
  }

  // ─── template list ──────────────────────────────────────────

  describe("template list", () => {
    it("lists all built-in templates with source labels", () => {
      const { stdout, exitCode } = run("template list", { cwd: tmpDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("[built-in]");
      expect(stdout).toContain("gsd");
      expect(stdout).toContain("bug-fix-pipeline");
      expect(stdout).toContain("bmad-method");
    });

    it("shows installed templates alongside built-ins", () => {
      writeTeamYaml(".openteams/templates/my-custom", "my-custom");
      const { stdout, exitCode } = run("template list", { cwd: tmpDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("my-custom");
      expect(stdout).toContain("[installed]");
      expect(stdout).toContain("[built-in]");
    });

    it("shows shadow indicator when installed template overrides built-in", () => {
      writeTeamYaml(".openteams/templates/gsd", "custom-gsd");
      const { stdout, exitCode } = run("template list", { cwd: tmpDir });
      expect(exitCode).toBe(0);
      // The installed version shows without shadow
      expect(stdout).toMatch(/gsd\s+\[installed\]/);
      // The built-in version is marked as shadowed
      expect(stdout).toContain("(shadowed by installed)");
    });

    it("filters by --source built-in", () => {
      writeTeamYaml(".openteams/templates/my-custom", "my-custom");
      const { stdout, exitCode } = run("template list --source built-in", {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("[built-in]");
      expect(stdout).not.toContain("[installed]");
      expect(stdout).not.toContain("my-custom");
    });

    it("filters by --source installed", () => {
      writeTeamYaml(".openteams/templates/my-custom", "my-custom");
      const { stdout, exitCode } = run("template list --source installed", {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("my-custom");
      expect(stdout).toContain("[installed]");
      expect(stdout).not.toContain("[built-in]");
    });

    it("respects config include filter", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { include: ["gsd"] } })
      );
      const { stdout, exitCode } = run("template list", { cwd: tmpDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("gsd");
      expect(stdout).not.toContain("bmad-method");
      expect(stdout).not.toContain("bug-fix-pipeline");
    });

    it("respects config exclude filter", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { exclude: ["gsd", "bmad-method"] } })
      );
      const { stdout, exitCode } = run("template list", { cwd: tmpDir });
      expect(exitCode).toBe(0);
      expect(stdout).not.toMatch(/\bgsd\b.*\[built-in\]/);
      expect(stdout).not.toContain("bmad-method");
      expect(stdout).toContain("bug-fix-pipeline");
    });
  });

  // ─── template validate ──────────────────────────────────────

  describe("template validate", () => {
    it("validates a built-in template by name", () => {
      const { stdout, exitCode } = run("template validate gsd", {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"gsd" is valid');
      expect(stdout).toContain("Roles:");
      expect(stdout).toContain("orchestrator");
    });

    it("validates a local template by path", () => {
      writeTeamYaml("my-team", "my-team");
      const dir = path.join(tmpDir, "my-team");
      const { stdout, exitCode } = run(`template validate ${dir}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"my-team" is valid');
    });

    it("validates an installed template by name", () => {
      writeTeamYaml(".openteams/templates/my-installed", "my-installed");
      const { stdout, exitCode } = run("template validate my-installed", {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"my-installed" is valid');
    });

    it("prefers installed template over built-in with same name", () => {
      writeFile(
        ".openteams/templates/gsd/team.yaml",
        `name: custom-gsd\nversion: 1\nroles:\n  - custom-worker\ntopology:\n  root:\n    role: custom-worker\n`
      );
      const { stdout, exitCode } = run("template validate gsd", {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"custom-gsd" is valid');
      expect(stdout).toContain("custom-worker");
    });

    it("fails for nonexistent template name", () => {
      const { stderr, exitCode } = run("template validate nonexistent-xyz", {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Invalid template");
      expect(stderr).toContain("not found");
    });

    it("fails for invalid template directory", () => {
      // directory without team.yaml
      fs.mkdirSync(path.join(tmpDir, "empty-dir"));
      const { stderr, exitCode } = run(
        `template validate ${path.join(tmpDir, "empty-dir")}`
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("team.yaml not found");
    });

    it("fails for disabled built-in when config excludes it", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { include: ["bug-fix-pipeline"] } })
      );
      const { stderr, exitCode } = run("template validate gsd", {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("not found");
    });
  });

  // ─── template init ─────────────────────────────────────────

  describe("template init", () => {
    it("creates .openteams/config.json with all defaults", () => {
      const { stdout, exitCode } = run(`template init -d ${tmpDir}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Created");
      expect(stdout).toContain("All built-in templates are active");

      const configPath = path.join(tmpDir, ".openteams", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config).toEqual({});
    });

    it("creates config with --include filter", () => {
      const { stdout, exitCode } = run(
        `template init --include gsd bug-fix-pipeline -d ${tmpDir}`
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Active built-ins: gsd, bug-fix-pipeline");

      const config = JSON.parse(
        fs.readFileSync(
          path.join(tmpDir, ".openteams", "config.json"),
          "utf-8"
        )
      );
      expect(config).toEqual({
        defaults: { include: ["gsd", "bug-fix-pipeline"] },
      });
    });

    it("creates config with --exclude filter", () => {
      const { stdout, exitCode } = run(
        `template init --exclude bmad-method -d ${tmpDir}`
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Excluded built-ins: bmad-method");

      const config = JSON.parse(
        fs.readFileSync(
          path.join(tmpDir, ".openteams", "config.json"),
          "utf-8"
        )
      );
      expect(config).toEqual({
        defaults: { exclude: ["bmad-method"] },
      });
    });

    it("rejects --include and --exclude together", () => {
      const { stderr, exitCode } = run(
        `template init --include gsd --exclude bmad-method -d ${tmpDir}`
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Cannot use both --include and --exclude");
    });

    it("rejects unknown template names", () => {
      const { stderr, exitCode } = run(
        `template init --include gsd fake-template -d ${tmpDir}`
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Unknown built-in template(s): fake-template");
      expect(stderr).toContain("Available:");
    });

    it("init then list shows only included templates", () => {
      run(`template init --include gsd -d ${tmpDir}`);
      const { stdout } = run("template list", { cwd: tmpDir });
      expect(stdout).toContain("gsd");
      expect(stdout).not.toContain("bmad-method");
      expect(stdout).not.toContain("bug-fix-pipeline");
    });

    it("overwrites existing config", () => {
      run(`template init --include gsd -d ${tmpDir}`);
      run(`template init --exclude bmad-method -d ${tmpDir}`);
      const config = JSON.parse(
        fs.readFileSync(
          path.join(tmpDir, ".openteams", "config.json"),
          "utf-8"
        )
      );
      expect(config).toEqual({
        defaults: { exclude: ["bmad-method"] },
      });
    });
  });

  // ─── end-to-end workflows ──────────────────────────────────

  describe("end-to-end workflows", () => {
    it("init → install override → list shows shadow → validate uses override", () => {
      // 1. Init with all defaults
      run(`template init -d ${tmpDir}`);

      // 2. "Install" a custom gsd that overrides the built-in
      writeFile(
        ".openteams/templates/gsd/team.yaml",
        `name: my-gsd\nversion: 2\nroles:\n  - lead\n  - coder\ntopology:\n  root:\n    role: lead\n  spawn_rules:\n    lead: [coder]\n    coder: []\n`
      );

      // 3. List shows both with shadow
      const { stdout: listOut } = run("template list", { cwd: tmpDir });
      expect(listOut).toMatch(/gsd\s+\[installed\]/);
      expect(listOut).toContain("(shadowed by installed)");

      // 4. Validate resolves to the override
      const { stdout: valOut } = run("template validate gsd", {
        cwd: tmpDir,
      });
      expect(valOut).toContain('"my-gsd" is valid');
      expect(valOut).toContain("lead");
    });

    it("init with include → excluded built-in cannot be loaded by name", () => {
      run(`template init --include gsd -d ${tmpDir}`);

      // gsd works
      const { exitCode: gsdCode } = run("template validate gsd", {
        cwd: tmpDir,
      });
      expect(gsdCode).toBe(0);

      // bmad-method is excluded
      const { exitCode: bmadCode, stderr } = run(
        "template validate bmad-method",
        { cwd: tmpDir }
      );
      expect(bmadCode).toBe(1);
      expect(stderr).toContain("not found");
    });

    it("installed template is accessible even when config excludes built-in with same name", () => {
      // Exclude gsd from built-ins
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { exclude: ["gsd"] } })
      );

      // But install a custom gsd
      writeTeamYaml(".openteams/templates/gsd", "installed-gsd");

      // Should still resolve — installed takes priority over config filtering
      const { stdout, exitCode } = run("template validate gsd", {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"installed-gsd" is valid');
    });
  });
});
