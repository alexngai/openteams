/**
 * Acceptance tests for the `openteams bundle` CLI commands.
 * Runs the CLI as a subprocess to test end-to-end behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

import { LOADOUT_RESOURCE_TYPE, TEAM_RESOURCE_TYPE } from "../sync/types";

const CLI = path.resolve(__dirname, "../cli.ts");
const RUN = `npx tsx ${CLI}`;
const DEMO = path.resolve(__dirname, "../../examples/loadout-demo");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(args: string, opts?: { input?: string }): RunResult {
  try {
    const stdout = execSync(`${RUN} ${args}`, {
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 20000,
      input: opts?.input,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("openteams bundle CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-bundle-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("bundle team", () => {
    it("produces a valid x-openteams/team resource on stdout", () => {
      const result = run(`bundle team ${DEMO}`);
      expect(result.exitCode).toBe(0);
      const resource = JSON.parse(result.stdout);
      expect(resource.type).toBe(TEAM_RESOURCE_TYPE);
      expect(resource.id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(resource.metadata.bundleVersion).toBe(1);
      expect(Object.keys(resource.metadata.loadouts).length).toBeGreaterThan(0);
    });

    it("writes to a file with --output", () => {
      const out = path.join(tmpDir, "team.bundle.json");
      const result = run(`bundle team ${DEMO} -o ${out}`);
      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(out)).toBe(true);
      const resource = JSON.parse(fs.readFileSync(out, "utf-8"));
      expect(resource.type).toBe(TEAM_RESOURCE_TYPE);
    });

    it("includes descriptive metadata when supplied (without changing the hash)", () => {
      const a = JSON.parse(run(`bundle team ${DEMO}`).stdout);
      const b = JSON.parse(
        run(
          `bundle team ${DEMO} --description "demo team" --tag x --tag y --owner agent_alex`
        ).stdout
      );
      expect(a.id).toBe(b.id);
      expect(b.metadata.description).toBe("demo team");
      expect(b.metadata.tags).toEqual(["x", "y"]);
      expect(b.owner_id).toBe("agent_alex");
    });

    it("respects --name override", () => {
      const result = run(`bundle team ${DEMO} --name renamed-team`);
      expect(result.exitCode).toBe(0);
      const resource = JSON.parse(result.stdout);
      expect(resource.name).toBe("renamed-team");
    });
  });

  describe("bundle loadout", () => {
    it("produces a valid x-openteams/loadout resource", () => {
      const result = run(`bundle loadout ${DEMO} code-reviewer`);
      expect(result.exitCode).toBe(0);
      const resource = JSON.parse(result.stdout);
      expect(resource.type).toBe(LOADOUT_RESOURCE_TYPE);
      expect(resource.name).toBe("code-reviewer");
      expect(resource.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("errors with available list when loadout name is unknown", () => {
      const result = run(`bundle loadout ${DEMO} bogus-loadout`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Loadout not found: bogus-loadout");
      expect(result.stderr).toContain("Available:");
    });

    it("matches the embedded id from the team bundle", () => {
      const team = JSON.parse(run(`bundle team ${DEMO}`).stdout);
      const standalone = JSON.parse(
        run(`bundle loadout ${DEMO} code-reviewer`).stdout
      );
      expect(team.metadata.loadouts["code-reviewer"].id).toBe(standalone.id);
    });
  });

  describe("bundle verify", () => {
    it("reports OK for an intact bundle", () => {
      const out = path.join(tmpDir, "loadout.bundle.json");
      run(`bundle loadout ${DEMO} code-reviewer -o ${out}`);
      const result = run(`bundle verify ${out}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OK");
      expect(result.stdout).toContain(LOADOUT_RESOURCE_TYPE);
    });

    it("reports MISMATCH when the id is tampered with", () => {
      const out = path.join(tmpDir, "loadout.bundle.json");
      run(`bundle loadout ${DEMO} code-reviewer -o ${out}`);
      const resource = JSON.parse(fs.readFileSync(out, "utf-8"));
      resource.id = "sha256:" + "0".repeat(64);
      fs.writeFileSync(out, JSON.stringify(resource));

      const result = run(`bundle verify ${out}`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("MISMATCH");
    });

    it("verifies a team bundle", () => {
      const out = path.join(tmpDir, "team.bundle.json");
      run(`bundle team ${DEMO} -o ${out}`);
      const result = run(`bundle verify ${out}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OK");
      expect(result.stdout).toContain(TEAM_RESOURCE_TYPE);
    });

    it("reads from stdin when file is '-'", () => {
      const json = run(`bundle loadout ${DEMO} code-reviewer`).stdout;
      const result = run(`bundle verify -`, { input: json });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OK");
    });

    it("rejects unrecognized resource types", () => {
      const out = path.join(tmpDir, "wrong.json");
      fs.writeFileSync(out, JSON.stringify({ type: "x-other/thing", id: "abc" }));
      const result = run(`bundle verify ${out}`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unrecognized resource type");
    });

    it("rejects malformed JSON", () => {
      const out = path.join(tmpDir, "broken.json");
      fs.writeFileSync(out, "{ not valid json");
      const result = run(`bundle verify ${out}`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid JSON");
    });
  });
});
