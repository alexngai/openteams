/**
 * Acceptance tests for the `openteams generate` CLI commands.
 * Verifies template name resolution works end-to-end through generators.
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

describe("openteams generate CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-gen-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relPath: string, content: string): void {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }

  describe("generate skill", () => {
    it("generates SKILL.md from a built-in template by name", () => {
      const outPath = path.join(tmpDir, "SKILL.md");
      const { stdout, exitCode } = run(
        `generate skill gsd -o ${outPath}`,
        { cwd: tmpDir }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Generated SKILL.md");
      expect(fs.existsSync(outPath)).toBe(true);

      const content = fs.readFileSync(outPath, "utf-8");
      expect(content).toContain("gsd");
    });

    it("fails for unknown template name", () => {
      const { stderr, exitCode } = run(
        `generate skill nonexistent -o ${path.join(tmpDir, "out.md")}`,
        { cwd: tmpDir }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("not found");
    });
  });

  describe("generate agents", () => {
    it("generates agent prompts from a built-in template by name", () => {
      const outDir = path.join(tmpDir, "agents");
      const { stdout, exitCode } = run(
        `generate agents bug-fix-pipeline -o ${outDir}`,
        { cwd: tmpDir }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("agent prompt(s)");

      // bug-fix-pipeline has 5 roles
      expect(fs.existsSync(path.join(outDir, "triager.md"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "fixer.md"))).toBe(true);
    });
  });

  describe("generate all", () => {
    it("generates SKILL.md and agents from a built-in template by name", () => {
      const outDir = path.join(tmpDir, "output");
      fs.mkdirSync(outDir, { recursive: true });
      const { stdout, exitCode } = run(
        `generate all bug-fix-pipeline -o ${outDir}`,
        { cwd: tmpDir }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Generated");
      expect(stdout).toContain("SKILL.md");

      expect(fs.existsSync(path.join(outDir, "SKILL.md"))).toBe(true);
      expect(
        fs.existsSync(path.join(outDir, "agents", "triager.md"))
      ).toBe(true);
    });

    it("uses installed template over built-in when both exist", () => {
      writeFile(
        ".openteams/templates/gsd/team.yaml",
        `name: custom-gsd\nversion: 1\nroles:\n  - custom-role\ntopology:\n  root:\n    role: custom-role\n`
      );
      writeFile(
        ".openteams/templates/gsd/roles/custom-role.yaml",
        `name: custom-role\ndescription: "A custom role"\ncapabilities:\n  - coding\n`
      );

      const outDir = path.join(tmpDir, "output");
      fs.mkdirSync(outDir, { recursive: true });
      const { stdout, exitCode } = run(`generate all gsd -o ${outDir}`, {
        cwd: tmpDir,
      });
      expect(exitCode).toBe(0);

      const skillContent = fs.readFileSync(
        path.join(outDir, "SKILL.md"),
        "utf-8"
      );
      expect(skillContent).toContain("custom-gsd");

      expect(
        fs.existsSync(path.join(outDir, "agents", "custom-role.md"))
      ).toBe(true);
    });

    it("respects config include filter", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { include: ["gsd"] } })
      );

      // gsd works
      const outDir1 = path.join(tmpDir, "out1");
      fs.mkdirSync(outDir1);
      const { exitCode: code1 } = run(`generate all gsd -o ${outDir1}`, {
        cwd: tmpDir,
      });
      expect(code1).toBe(0);

      // bmad-method is excluded
      const outDir2 = path.join(tmpDir, "out2");
      fs.mkdirSync(outDir2);
      const { exitCode: code2 } = run(
        `generate all bmad-method -o ${outDir2}`,
        { cwd: tmpDir }
      );
      expect(code2).toBe(1);
    });
  });

  describe("generate catalog", () => {
    it("generates catalog from a built-in template by name", () => {
      const outPath = path.join(tmpDir, "catalog.md");
      const { exitCode } = run(
        `generate catalog gsd -o ${outPath}`,
        { cwd: tmpDir }
      );
      expect(exitCode).toBe(0);
      expect(fs.existsSync(outPath)).toBe(true);

      const content = fs.readFileSync(outPath, "utf-8");
      expect(content).toContain("gsd");
    });
  });

  describe("generate package", () => {
    it("generates package from a built-in template by name", () => {
      const outDir = path.join(tmpDir, "pkg");
      const { stdout, exitCode } = run(
        `generate package gsd -o ${outDir}`,
        { cwd: tmpDir }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Generated skill package");
      expect(fs.existsSync(outDir)).toBe(true);
    });
  });
});
