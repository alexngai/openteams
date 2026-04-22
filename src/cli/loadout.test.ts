/**
 * Acceptance tests for the `openteams loadout` CLI commands.
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

describe("openteams loadout CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-loadout-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relPath: string, content: string): void {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }

  function writeDemoTemplate(): void {
    write(
      "team.yaml",
      `name: demo\nversion: 1\nroles: [planner, worker]\ntopology:\n  root: { role: planner }\n`
    );
    write("roles/planner.yaml", "name: planner\ncapabilities: [task.create]\n");
    write("roles/worker.yaml", "name: worker\nloadout: base\n");
    write(
      "loadouts/base.yaml",
      `name: base\ncapabilities: [file.read]\nmcp_servers:\n  - name: ast-grep\n    command: npx\npermissions:\n  deny: ["Bash(git push:*)"]\n`
    );
    write(
      "loadouts/extended.yaml",
      `name: extended\nextends: base\ncapabilities_add: [exec.test]\nmcp_servers:\n  - ref: "@org/ref"\n`
    );
  }

  // ─── validate ──────────────────────────────────────────────

  describe("loadout validate", () => {
    it("reports all loadouts with capability + MCP counts", () => {
      writeDemoTemplate();
      const { stdout, exitCode } = run(`loadout validate ${tmpDir}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Template "demo"');
      expect(stdout).toContain("base");
      expect(stdout).toContain("extended extends base");
      expect(stdout).toMatch(/\d+ cap/);
      expect(stdout).toMatch(/\d+ MCP/);
    });

    it("handles a template with no loadouts gracefully", () => {
      write(
        "team.yaml",
        `name: solo\nversion: 1\nroles: [a]\ntopology:\n  root: { role: a }\n`
      );
      const { stdout, exitCode } = run(`loadout validate ${tmpDir}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("has no loadouts");
    });

    it("exits non-zero on malformed template", () => {
      write("team.yaml", "{]not-yaml");
      const { stderr, exitCode } = run(`loadout validate ${tmpDir}`);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Invalid template");
    });
  });

  // ─── list ──────────────────────────────────────────────────

  describe("loadout list", () => {
    it("shows named loadouts and role consumers", () => {
      writeDemoTemplate();
      const { stdout, exitCode } = run(`loadout list ${tmpDir}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Loadout");
      expect(stdout).toContain("Consumers");
      expect(stdout).toMatch(/base\s+worker/);
      expect(stdout).toMatch(/extended\s+\(unused\)/);
    });

    it("reports roles with inline loadouts separately", () => {
      writeDemoTemplate();
      write(
        "roles/inline-role.yaml",
        "name: worker\nloadout:\n  capabilities: [file.write]\n"
      );
      // Override the existing worker role with an inline loadout
      write(
        "roles/worker.yaml",
        "name: worker\nloadout:\n  capabilities: [file.write]\n"
      );
      const { stdout, exitCode } = run(`loadout list ${tmpDir}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Roles with inline loadouts: worker");
    });
  });

  // ─── show ──────────────────────────────────────────────────

  describe("loadout show", () => {
    it("renders YAML for a named loadout by default", () => {
      writeDemoTemplate();
      const { stdout, exitCode } = run(`loadout show ${tmpDir} extended`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("name: extended");
      expect(stdout).toContain("extends: base");
      // Merged capabilities visible
      expect(stdout).toContain("file.read");
      expect(stdout).toContain("exec.test");
    });

    it("emits JSON artifacts with --json", () => {
      writeDemoTemplate();
      const { stdout, exitCode } = run(
        `loadout show ${tmpDir} extended --json`
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.name).toBe("extended");
      expect(parsed.mcpServerRefs).toHaveLength(1);
      expect(parsed.mcpServerRefs[0].ref).toBe("@org/ref");
    });

    it("errors on unknown loadout name", () => {
      writeDemoTemplate();
      const { stderr, exitCode } = run(`loadout show ${tmpDir} nonexistent`);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("not found");
      expect(stderr).toContain("Available:");
    });
  });

  // ─── preview ───────────────────────────────────────────────

  describe("loadout preview", () => {
    it("renders the effective loadout for a role with a slug binding", () => {
      writeDemoTemplate();
      const { stdout, exitCode } = run(`loadout preview ${tmpDir} worker`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Effective loadout for role "worker"');
      expect(stdout).toContain("name: base");
    });

    it("reports roles without a loadout", () => {
      writeDemoTemplate();
      const { stdout, exitCode } = run(`loadout preview ${tmpDir} planner`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("has no loadout binding");
    });

    it("errors on unknown role", () => {
      writeDemoTemplate();
      const { stderr, exitCode } = run(`loadout preview ${tmpDir} ghost`);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("not found");
    });

    it("emits JSON artifacts with --json", () => {
      writeDemoTemplate();
      const { stdout, exitCode } = run(
        `loadout preview ${tmpDir} worker --json`
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.name).toBe("base");
      expect(parsed.capabilities).toContain("file.read");
    });
  });
});
