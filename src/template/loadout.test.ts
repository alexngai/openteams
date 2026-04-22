import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { TemplateLoader } from "./loader";
import { mergeLoadout, resolveStandaloneLoadout } from "./loadout-merge";
import type { LoadoutDefinition, ResolvedLoadout } from "./types";

describe("Loadouts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-loadout-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relPath: string, content: string): void {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }

  function writeMinimalTeam(extraRolesYaml = ""): void {
    write(
      "team.yaml",
      `
name: test-team
version: 1
roles:
  - worker
topology:
  root:
    role: worker
${extraRolesYaml}
`
    );
  }

  // ────────────────────────────────────────────────────────────
  // Baseline — backward compatibility
  // ────────────────────────────────────────────────────────────

  describe("backward compatibility", () => {
    it("loads a template with no loadouts/ directory", () => {
      writeMinimalTeam();
      const template = TemplateLoader.load(tmpDir);
      expect(template.loadouts).toBeInstanceOf(Map);
      expect(template.loadouts.size).toBe(0);
    });

    it("role.loadout is undefined when role YAML does not declare one", () => {
      writeMinimalTeam();
      write("roles/worker.yaml", "name: worker\ncapabilities: [file.read]\n");
      const template = TemplateLoader.load(tmpDir);
      expect(template.roles.get("worker")!.loadout).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────
  // Loading from disk
  // ────────────────────────────────────────────────────────────

  describe("disk loading", () => {
    it("loads a single standalone loadout from loadouts/<name>.yaml", () => {
      writeMinimalTeam();
      write(
        "loadouts/code-reviewer.yaml",
        `
name: code-reviewer
description: Reviews code
capabilities: [file.read, git.diff]
permissions:
  allow: ["Bash(npm test:*)"]
`
      );
      const template = TemplateLoader.load(tmpDir);
      expect(template.loadouts.size).toBe(1);
      const lo = template.loadouts.get("code-reviewer")!;
      expect(lo.capabilities).toEqual(["file.read", "git.diff"]);
      expect(lo.permissions.allow).toEqual(["Bash(npm test:*)"]);
      expect(lo.description).toBe("Reviews code");
    });

    it("rejects a loadout whose name does not match the filename stem", () => {
      writeMinimalTeam();
      write("loadouts/reviewer.yaml", "name: code-reviewer\n");
      expect(() => TemplateLoader.load(tmpDir)).toThrow(/must match filename stem/);
    });

    it("accepts .yml extension", () => {
      writeMinimalTeam();
      write("loadouts/debugger.yml", "name: debugger\ncapabilities: [file.read]\n");
      const template = TemplateLoader.load(tmpDir);
      expect(template.loadouts.get("debugger")).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────
  // Role binding
  // ────────────────────────────────────────────────────────────

  describe("role binding", () => {
    it("attaches a slug-referenced loadout to a role", () => {
      writeMinimalTeam();
      write(
        "loadouts/code-reviewer.yaml",
        `
name: code-reviewer
capabilities: [file.read, git.diff]
`
      );
      write(
        "roles/worker.yaml",
        `
name: worker
loadout: code-reviewer
`
      );
      const template = TemplateLoader.load(tmpDir);
      const worker = template.roles.get("worker")!;
      expect(worker.loadout).toBeDefined();
      expect(worker.loadout!.name).toBe("code-reviewer");
      expect(worker.loadout!.capabilities).toEqual(["file.read", "git.diff"]);
    });

    it("attaches an inline loadout definition to a role", () => {
      writeMinimalTeam();
      write(
        "roles/worker.yaml",
        `
name: worker
loadout:
  capabilities: [file.read]
  prompt_addendum: "Be careful"
`
      );
      const template = TemplateLoader.load(tmpDir);
      const worker = template.roles.get("worker")!;
      expect(worker.loadout).toBeDefined();
      expect(worker.loadout!.name).toBe("__inline:worker");
      expect(worker.loadout!.capabilities).toEqual(["file.read"]);
      expect(worker.loadout!.promptAddendum).toBe("Be careful");
    });

    it("inline loadout can extend a named loadout", () => {
      writeMinimalTeam();
      write(
        "loadouts/code-reviewer.yaml",
        `
name: code-reviewer
capabilities: [file.read, git.diff]
permissions:
  deny: ["Bash(git push:*)"]
`
      );
      write(
        "roles/worker.yaml",
        `
name: worker
loadout:
  extends: code-reviewer
  capabilities_add: [exec.test]
`
      );
      const template = TemplateLoader.load(tmpDir);
      const worker = template.roles.get("worker")!;
      expect(worker.loadout!.capabilities.sort()).toEqual(
        ["exec.test", "file.read", "git.diff"].sort()
      );
      expect(worker.loadout!.permissions.deny).toEqual(["Bash(git push:*)"]);
    });

    it("throws when a role references an unknown loadout slug", () => {
      writeMinimalTeam();
      write("roles/worker.yaml", "name: worker\nloadout: nonexistent\n");
      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        /references unknown loadout/
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // Inheritance & merge semantics
  // ────────────────────────────────────────────────────────────

  describe("inheritance", () => {
    it("merges capabilities via CapabilityComposition", () => {
      const parent = resolveStandaloneLoadout({
        name: "parent",
        capabilities: ["file.read", "git.diff"],
      });
      const child: LoadoutDefinition = {
        name: "child",
        extends: "parent",
        capabilities_add: ["exec.test"],
        capabilities_remove: ["git.diff"],
      };
      const merged = mergeLoadout(parent, child);
      expect(merged.capabilities.sort()).toEqual(["exec.test", "file.read"]);
    });

    it("unions MCP servers, child wins on name conflict", () => {
      const parent = resolveStandaloneLoadout({
        name: "parent",
        mcp_servers: [
          { name: "ast-grep", command: "old-path" },
          { name: "chrome-devtools", command: "npx", args: ["chrome-devtools-mcp"] },
        ],
      });
      const merged = mergeLoadout(parent, {
        name: "child",
        mcp_servers: [
          { name: "ast-grep", command: "new-path" },
          { name: "filesystem", command: "fs-mcp" },
        ],
      });
      expect(merged.mcpServers).toHaveLength(3);
      const astGrep = merged.mcpServers.find(
        (s) => "name" in s && s.name === "ast-grep"
      );
      expect(astGrep).toMatchObject({ name: "ast-grep", command: "new-path" });
    });

    it("deny always wins (child cannot drop parent deny)", () => {
      const parent = resolveStandaloneLoadout({
        name: "parent",
        permissions: { deny: ["Bash(rm -rf:*)"] },
      });
      const merged = mergeLoadout(parent, {
        name: "child",
        permissions: { allow: ["Bash(rm -rf:*)"] }, // attempts override
      });
      expect(merged.permissions.deny).toEqual(["Bash(rm -rf:*)"]);
      expect(merged.permissions.allow).toEqual(["Bash(rm -rf:*)"]);
      // Consumers should apply deny-wins at materialization time; we surface both.
    });

    it("merges skills: profile replaces, include unions, max_tokens replaces if set", () => {
      const parent = resolveStandaloneLoadout({
        name: "parent",
        skills: {
          profile: "code-reviewer",
          include: ["skill-a"],
          max_tokens: 10000,
        },
      });
      const merged = mergeLoadout(parent, {
        name: "child",
        skills: {
          profile: "security-engineer",
          include: ["skill-b"],
        },
      });
      expect(merged.skills?.profile).toBe("security-engineer");
      expect(merged.skills?.include?.sort()).toEqual(["skill-a", "skill-b"]);
      expect(merged.skills?.max_tokens).toBe(10000); // parent retained when child omits
    });

    it("concatenates prompt_addendum parent-then-child", () => {
      const parent = resolveStandaloneLoadout({
        name: "parent",
        prompt_addendum: "First line",
      });
      const merged = mergeLoadout(parent, {
        name: "child",
        prompt_addendum: "Second line",
      });
      expect(merged.promptAddendum).toBe("First line\n\nSecond line");
    });

    it("resolves multi-level inheritance at load time", () => {
      writeMinimalTeam();
      write(
        "loadouts/base.yaml",
        "name: base\ncapabilities: [file.read]\n"
      );
      write(
        "loadouts/middle.yaml",
        `
name: middle
extends: base
capabilities_add: [git.diff]
`
      );
      write(
        "loadouts/leaf.yaml",
        `
name: leaf
extends: middle
capabilities_add: [exec.test]
`
      );
      const template = TemplateLoader.load(tmpDir);
      const leaf = template.loadouts.get("leaf")!;
      expect(leaf.capabilities.sort()).toEqual(
        ["exec.test", "file.read", "git.diff"].sort()
      );
    });

    it("detects circular loadout inheritance", () => {
      writeMinimalTeam();
      write("loadouts/a.yaml", "name: a\nextends: b\n");
      write("loadouts/b.yaml", "name: b\nextends: a\n");
      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        /Circular loadout inheritance/
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // External resolver hooks
  // ────────────────────────────────────────────────────────────

  describe("external resolver", () => {
    it("resolves a loadout's extends target via the external hook", () => {
      writeMinimalTeam();
      write(
        "loadouts/child.yaml",
        `
name: child
extends: remote-base
capabilities_add: [exec.test]
`
      );

      const remoteBase: ResolvedLoadout = {
        name: "remote-base",
        description: "Fetched from DB",
        capabilities: ["file.read"],
        mcpServers: [],
        permissions: {},
        raw: { name: "remote-base" },
      };

      const template = TemplateLoader.load(tmpDir, {
        resolveExternalLoadout: (name) =>
          name === "remote-base" ? remoteBase : null,
      });
      const child = template.loadouts.get("child")!;
      expect(child.capabilities.sort()).toEqual(["exec.test", "file.read"]);
    });

    it("resolves a role's loadout slug via the external hook", () => {
      writeMinimalTeam();
      write("roles/worker.yaml", "name: worker\nloadout: db-loadout\n");

      const dbLoadout: ResolvedLoadout = {
        name: "db-loadout",
        description: "Stored in hive DB",
        capabilities: ["file.read"],
        mcpServers: [],
        permissions: {},
        raw: { name: "db-loadout" },
      };

      const template = TemplateLoader.load(tmpDir, {
        resolveExternalLoadout: (name) =>
          name === "db-loadout" ? dbLoadout : null,
      });
      const worker = template.roles.get("worker")!;
      expect(worker.loadout!.name).toBe("db-loadout");
    });

    it("postProcessLoadout hook transforms each resolved loadout", () => {
      writeMinimalTeam();
      write(
        "loadouts/base.yaml",
        "name: base\ncapabilities: [file.read]\n"
      );
      const template = TemplateLoader.load(tmpDir, {
        postProcessLoadout: (lo) => ({
          ...lo,
          description: `[processed] ${lo.description}`,
        }),
      });
      expect(template.loadouts.get("base")!.description).toMatch(/^\[processed\]/);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Async variant
  // ────────────────────────────────────────────────────────────

  describe("async loader", () => {
    it("loadAsync resolves loadouts identically to load", async () => {
      writeMinimalTeam();
      write(
        "loadouts/base.yaml",
        "name: base\ncapabilities: [file.read]\n"
      );
      const template = await TemplateLoader.loadAsync(tmpDir);
      expect(template.loadouts.get("base")!.capabilities).toEqual(["file.read"]);
    });

    it("loadAsync awaits async external loadout resolver", async () => {
      writeMinimalTeam();
      write("roles/worker.yaml", "name: worker\nloadout: async-loadout\n");

      const template = await TemplateLoader.loadAsync(tmpDir, {
        resolveExternalLoadout: async (name) => {
          await new Promise((r) => setTimeout(r, 1));
          return name === "async-loadout"
            ? {
                name,
                description: "async",
                capabilities: ["file.read"],
                mcpServers: [],
                permissions: {},
                raw: { name },
              }
            : null;
        },
      });
      expect(template.roles.get("worker")!.loadout!.name).toBe("async-loadout");
    });
  });
});
