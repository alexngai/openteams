import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { TemplateLoader } from "./loader";
import {
  mergeLoadout,
  normalizeMcpEntries,
  resolveStandaloneLoadout,
} from "./loadout-merge";
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
        mcpScope: [],
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
        mcpScope: [],
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

  // ────────────────────────────────────────────────────────────
  // MCP scope normalization
  // ────────────────────────────────────────────────────────────

  describe("MCP scope normalization", () => {
    it("treats a bare string as full-scope reference", () => {
      const { installs, scopes } = normalizeMcpEntries(["opentasks"]);
      expect(installs).toEqual([]);
      expect(scopes).toEqual([{ server: "opentasks" }]);
    });

    it("treats single-key object with array value as tool allowlist", () => {
      const { installs, scopes } = normalizeMcpEntries([
        { "chrome-devtools": ["navigate", "screenshot"] },
      ]);
      expect(installs).toEqual([]);
      expect(scopes).toEqual([
        { server: "chrome-devtools", tools: ["navigate", "screenshot"] },
      ]);
    });

    it("treats single-key object with opts value as scope options", () => {
      const { installs, scopes } = normalizeMcpEntries([
        { "ast-grep": { tools: ["search"], exclude: ["dangerous_replace"] } },
      ]);
      expect(installs).toEqual([]);
      expect(scopes).toEqual([
        { server: "ast-grep", tools: ["search"], exclude: ["dangerous_replace"] },
      ]);
    });

    it("treats install spec as install + full scope", () => {
      const { installs, scopes } = normalizeMcpEntries([
        { name: "bespoke", command: "node", args: ["./x.js"] },
      ]);
      expect(installs).toHaveLength(1);
      expect(installs[0]).toMatchObject({ name: "bespoke", command: "node" });
      expect(scopes).toEqual([{ server: "bespoke" }]);
    });

    it("treats ref entry as install-only (scope deferred to consumer)", () => {
      const { installs, scopes } = normalizeMcpEntries([
        { ref: "@openhive/secrets" },
      ]);
      expect(installs).toHaveLength(1);
      expect("ref" in installs[0] ? installs[0].ref : undefined).toBe("@openhive/secrets");
      expect(scopes).toEqual([]);
    });

    it("rejects malformed entries", () => {
      expect(() => normalizeMcpEntries([42 as unknown])).toThrow(
        /Unrecognized mcp_servers entry/
      );
      expect(() =>
        normalizeMcpEntries([{ a: "x", b: "y" } as unknown])
      ).toThrow(/Unrecognized mcp_servers entry/);
    });
  });

  // ────────────────────────────────────────────────────────────
  // MCP scope merge semantics
  // ────────────────────────────────────────────────────────────

  describe("MCP scope merge", () => {
    it("unions tools across inheritance", () => {
      const parent = resolveStandaloneLoadout({
        name: "p",
        mcp_servers: [{ "chrome-devtools": ["navigate"] }],
      });
      const merged = mergeLoadout(parent, {
        name: "c",
        mcp_servers: [{ "chrome-devtools": ["screenshot"] }],
      });
      const cd = merged.mcpScope.find((s) => s.server === "chrome-devtools")!;
      expect(cd.tools?.sort()).toEqual(["navigate", "screenshot"]);
    });

    it("unions exclude across inheritance (deny always wins)", () => {
      const parent = resolveStandaloneLoadout({
        name: "p",
        mcp_servers: [{ "ast-grep": { exclude: ["dangerous"] } }],
      });
      const merged = mergeLoadout(parent, {
        name: "c",
        mcp_servers: [{ "ast-grep": { exclude: ["reckless"] } }],
      });
      const ag = merged.mcpScope.find((s) => s.server === "ast-grep")!;
      expect(ag.exclude?.sort()).toEqual(["dangerous", "reckless"]);
    });

    it("child's bare reference does not unrestrict parent's allowlist", () => {
      const parent = resolveStandaloneLoadout({
        name: "p",
        mcp_servers: [{ "ast-grep": ["search"] }],
      });
      const merged = mergeLoadout(parent, {
        name: "c",
        mcp_servers: ["ast-grep"],
      });
      const ag = merged.mcpScope.find((s) => s.server === "ast-grep")!;
      expect(ag.tools).toEqual(["search"]); // parent restriction stands
    });

    it("new server in child produces a new scope entry", () => {
      const parent = resolveStandaloneLoadout({
        name: "p",
        mcp_servers: ["opentasks"],
      });
      const merged = mergeLoadout(parent, {
        name: "c",
        mcp_servers: ["filesystem"],
      });
      const names = merged.mcpScope.map((s) => s.server).sort();
      expect(names).toEqual(["filesystem", "opentasks"]);
    });

    it("install specs merge by name with child wins", () => {
      const parent = resolveStandaloneLoadout({
        name: "p",
        mcp_servers: [{ name: "ast-grep", command: "old" }],
      });
      const merged = mergeLoadout(parent, {
        name: "c",
        mcp_servers: [{ name: "ast-grep", command: "new" }],
      });
      expect(merged.mcpServers).toHaveLength(1);
      expect(merged.mcpServers[0]).toMatchObject({ name: "ast-grep", command: "new" });
      // Install also contributes a scope entry
      expect(merged.mcpScope).toEqual([{ server: "ast-grep" }]);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Team-level mcp_providers
  // ────────────────────────────────────────────────────────────

  describe("mcp_providers", () => {
    it("defaults to empty map when omitted from team.yaml", () => {
      writeMinimalTeam();
      const tpl = TemplateLoader.load(tmpDir);
      expect(tpl.mcpProviders.size).toBe(0);
    });

    it("parses stdio, http, and ref provider shapes", () => {
      write(
        "team.yaml",
        `
name: test
version: 1
roles: [worker]
topology:
  root: { role: worker }
mcp_providers:
  opentasks:
    command: node
    args: [./x.js]
    env: { LEVEL: info }
  remote-api:
    type: http
    url: https://mcp.example.com/mcp
    headers: { Authorization: "Bearer xyz" }
  secrets-scanner:
    ref: "@openhive/secrets-scanner"
    description: "Consumer-resolved"
`
      );
      const tpl = TemplateLoader.load(tmpDir);
      expect(tpl.mcpProviders.size).toBe(3);
      expect(tpl.mcpProviders.get("opentasks")).toMatchObject({
        command: "node",
        args: ["./x.js"],
        env: { LEVEL: "info" },
      });
      expect(tpl.mcpProviders.get("remote-api")).toMatchObject({
        type: "http",
        url: "https://mcp.example.com/mcp",
      });
      expect(tpl.mcpProviders.get("secrets-scanner")).toMatchObject({
        ref: "@openhive/secrets-scanner",
      });
    });

    it("rejects non-object provider entries with a clear error", () => {
      write(
        "team.yaml",
        `
name: test
version: 1
roles: [worker]
topology:
  root: { role: worker }
mcp_providers:
  bogus: "just-a-string"
`
      );
      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        /mcp_providers.bogus must be an object/
      );
    });
  });

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
                mcpScope: [],
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
