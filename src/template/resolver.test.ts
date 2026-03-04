import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  loadConfig,
  findConfigPath,
  findOpenTeamsDir,
  isBuiltinEnabled,
  resolveTemplateName,
  listAllTemplates,
  writeConfig,
} from "./resolver";
import type { OpenTeamsConfig } from "./types";

describe("resolver", () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-resolver-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
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

  describe("findOpenTeamsDir", () => {
    it("returns null when no .openteams/ exists", () => {
      expect(findOpenTeamsDir(tmpDir)).toBeNull();
    });

    it("finds .openteams/ in the given directory", () => {
      fs.mkdirSync(path.join(tmpDir, ".openteams"));
      expect(findOpenTeamsDir(tmpDir)).toBe(path.join(tmpDir, ".openteams"));
    });

    it("walks up to find .openteams/ in parent", () => {
      fs.mkdirSync(path.join(tmpDir, ".openteams"));
      const subDir = path.join(tmpDir, "sub", "deep");
      fs.mkdirSync(subDir, { recursive: true });
      expect(findOpenTeamsDir(subDir)).toBe(path.join(tmpDir, ".openteams"));
    });
  });

  describe("loadConfig", () => {
    it("returns null when no config exists", () => {
      expect(loadConfig(tmpDir)).toBeNull();
    });

    it("parses a valid config.json with include", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { include: ["gsd"] } })
      );
      const config = loadConfig(tmpDir);
      expect(config).toEqual({ defaults: { include: ["gsd"] } });
    });

    it("parses a valid config.json with exclude", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { exclude: ["bmad-method"] } })
      );
      const config = loadConfig(tmpDir);
      expect(config).toEqual({ defaults: { exclude: ["bmad-method"] } });
    });

    it("returns null for malformed JSON", () => {
      writeFile(".openteams/config.json", "not json{{{");
      expect(loadConfig(tmpDir)).toBeNull();
    });

    it("finds config.json in parent directory", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { include: ["gsd"] } })
      );
      const subDir = path.join(tmpDir, "sub");
      fs.mkdirSync(subDir, { recursive: true });
      expect(loadConfig(subDir)).toEqual({ defaults: { include: ["gsd"] } });
    });
  });

  describe("findConfigPath", () => {
    it("returns null when no .openteams exists", () => {
      expect(findConfigPath(tmpDir)).toBeNull();
    });

    it("returns null when .openteams exists but no config.json", () => {
      fs.mkdirSync(path.join(tmpDir, ".openteams"));
      expect(findConfigPath(tmpDir)).toBeNull();
    });

    it("returns path when config.json exists", () => {
      writeFile(".openteams/config.json", "{}");
      expect(findConfigPath(tmpDir)).toBe(
        path.join(tmpDir, ".openteams", "config.json")
      );
    });
  });

  describe("isBuiltinEnabled", () => {
    it("returns true when config is null", () => {
      expect(isBuiltinEnabled("gsd", null)).toBe(true);
    });

    it("returns true when defaults is undefined", () => {
      expect(isBuiltinEnabled("gsd", {})).toBe(true);
    });

    it("returns true for included names", () => {
      expect(
        isBuiltinEnabled("gsd", { defaults: { include: ["gsd", "docs-sync"] } })
      ).toBe(true);
    });

    it("returns false for non-included names when include is set", () => {
      expect(
        isBuiltinEnabled("bmad-method", { defaults: { include: ["gsd"] } })
      ).toBe(false);
    });

    it("returns true for non-excluded names", () => {
      expect(
        isBuiltinEnabled("gsd", { defaults: { exclude: ["bmad-method"] } })
      ).toBe(true);
    });

    it("returns false for excluded names", () => {
      expect(
        isBuiltinEnabled("bmad-method", {
          defaults: { exclude: ["bmad-method"] },
        })
      ).toBe(false);
    });

    it("returns true when both include and exclude are empty", () => {
      expect(
        isBuiltinEnabled("gsd", { defaults: { include: [], exclude: [] } })
      ).toBe(true);
    });
  });

  describe("resolveTemplateName", () => {
    it("resolves from local .openteams/templates/ first", () => {
      writeTeamYaml(".openteams/templates/my-team", "local-my-team");
      const result = resolveTemplateName("my-team", tmpDir);
      expect(result).toBe(
        path.join(tmpDir, ".openteams", "templates", "my-team")
      );
    });

    it("falls back to built-in when no installed version", () => {
      const result = resolveTemplateName("gsd", tmpDir);
      expect(result).not.toBeNull();
      expect(result!).toContain("examples");
    });

    it("local installed shadows built-in", () => {
      writeTeamYaml(".openteams/templates/gsd", "local-gsd");
      const result = resolveTemplateName("gsd", tmpDir);
      expect(result).toBe(
        path.join(tmpDir, ".openteams", "templates", "gsd")
      );
    });

    it("returns null for disabled built-in", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { include: ["bug-fix-pipeline"] } })
      );
      const result = resolveTemplateName("gsd", tmpDir);
      expect(result).toBeNull();
    });

    it("returns null for unknown name", () => {
      expect(resolveTemplateName("nonexistent", tmpDir)).toBeNull();
    });

    it("respects config include filter", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { include: ["gsd"] } })
      );
      expect(resolveTemplateName("gsd", tmpDir)).not.toBeNull();
      expect(resolveTemplateName("bmad-method", tmpDir)).toBeNull();
    });

    it("respects config exclude filter", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { exclude: ["gsd"] } })
      );
      expect(resolveTemplateName("gsd", tmpDir)).toBeNull();
      expect(resolveTemplateName("bmad-method", tmpDir)).not.toBeNull();
    });
  });

  describe("listAllTemplates", () => {
    it("lists built-in templates when no installed exist", () => {
      const templates = listAllTemplates(tmpDir);
      expect(templates.length).toBeGreaterThanOrEqual(8);
      expect(templates.every((t) => t.source === "built-in")).toBe(true);
    });

    it("lists installed templates alongside built-ins", () => {
      writeTeamYaml(".openteams/templates/my-team", "my-team");
      const templates = listAllTemplates(tmpDir);
      const myTeam = templates.find((t) => t.name === "my-team");
      expect(myTeam).toBeDefined();
      expect(myTeam!.source).toBe("installed");

      const gsd = templates.find(
        (t) => t.name === "gsd" && t.source === "built-in"
      );
      expect(gsd).toBeDefined();
    });

    it("marks shadow relationships correctly", () => {
      writeTeamYaml(".openteams/templates/gsd", "local-gsd");
      const templates = listAllTemplates(tmpDir);
      const gsdEntries = templates.filter((t) => t.name === "gsd");
      expect(gsdEntries.length).toBe(2);

      const installed = gsdEntries.find((t) => t.source === "installed");
      const builtin = gsdEntries.find((t) => t.source === "built-in");
      expect(installed).toBeDefined();
      expect(installed!.shadows).toBeUndefined();
      expect(builtin).toBeDefined();
      expect(builtin!.shadows).toBe("installed");
    });

    it("filters built-ins by config include", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { include: ["gsd"] } })
      );
      const templates = listAllTemplates(tmpDir);
      const builtins = templates.filter((t) => t.source === "built-in");
      expect(builtins.length).toBe(1);
      expect(builtins[0].name).toBe("gsd");
    });

    it("filters built-ins by config exclude", () => {
      writeFile(
        ".openteams/config.json",
        JSON.stringify({ defaults: { exclude: ["gsd", "bmad-method"] } })
      );
      const templates = listAllTemplates(tmpDir);
      const builtinNames = templates
        .filter((t) => t.source === "built-in")
        .map((t) => t.name);
      expect(builtinNames).not.toContain("gsd");
      expect(builtinNames).not.toContain("bmad-method");
      expect(builtinNames.length).toBeGreaterThanOrEqual(6);
    });

    it("returns sorted by name", () => {
      const templates = listAllTemplates(tmpDir);
      const names = templates.map((t) => t.name);
      expect(names).toEqual([...names].sort());
    });
  });

  describe("writeConfig", () => {
    it("creates .openteams/ directory if needed", () => {
      const configPath = writeConfig({}, tmpDir);
      expect(fs.existsSync(configPath)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".openteams"))).toBe(true);
    });

    it("writes valid JSON config", () => {
      const config: OpenTeamsConfig = { defaults: { include: ["gsd"] } };
      const configPath = writeConfig(config, tmpDir);
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(parsed).toEqual(config);
    });

    it("overwrites existing config", () => {
      writeConfig({ defaults: { include: ["gsd"] } }, tmpDir);
      writeConfig({ defaults: { exclude: ["bmad-method"] } }, tmpDir);
      const configPath = path.join(tmpDir, ".openteams", "config.json");
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(parsed).toEqual({ defaults: { exclude: ["bmad-method"] } });
    });
  });
});
