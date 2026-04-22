import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { TemplateLoader } from "../template/loader";
import {
  findMissingMcpReferences,
  generateLoadoutArtifacts,
  getEffectiveLoadout,
  getMcpProviders,
  listInlineLoadoutRoles,
  listLoadoutConsumers,
  renderLoadoutYaml,
} from "./loadout-generator";
import { generateAgentPrompt, generateRoleSkillMd } from "./agent-prompt-generator";
import { resolveStandaloneLoadout } from "../template/loadout-merge";

describe("loadout-generator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-lo-gen-"));
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
      `
name: demo
version: 1
roles: [planner, implementer, reviewer]
topology:
  root: { role: planner }
  spawn_rules:
    planner: [implementer, reviewer]
    implementer: []
    reviewer: []
`
    );
    write("roles/planner.yaml", "name: planner\ncapabilities: [task.create]\n");
    write("roles/implementer.yaml", "name: implementer\nloadout: implementer\n");
    write(
      "roles/reviewer.yaml",
      `
name: reviewer
loadout:
  extends: security-auditor
  capabilities_add: [task.update]
`
    );
    write(
      "loadouts/code-reviewer.yaml",
      `
name: code-reviewer
capabilities: [file.read, git.diff]
mcp_servers:
  - name: ast-grep
    command: npx
    args: [ast-grep-mcp]
permissions:
  allow: ["Read(**)"]
  deny: ["Bash(git push:*)"]
`
    );
    write(
      "loadouts/security-auditor.yaml",
      `
name: security-auditor
extends: code-reviewer
capabilities_add: [exec.test]
mcp_servers:
  - ref: "@openhive/secrets-scanner"
permissions:
  deny: ["Bash(curl *:*)"]
`
    );
    write(
      "loadouts/implementer.yaml",
      `
name: implementer
capabilities: [file.read, file.write]
mcp_servers:
  - name: filesystem
    command: fs-mcp
permissions:
  allow: ["Write(src/**)"]
prompt_addendum: |
  ## Implementation Mindset
  Match existing patterns.
`
    );
  }

  // ────────────────────────────────────────────────────────────
  // generateLoadoutArtifacts
  // ────────────────────────────────────────────────────────────

  describe("generateLoadoutArtifacts", () => {
    it("splits inline MCP entries from symbolic refs", () => {
      writeDemoTemplate();
      const tpl = TemplateLoader.load(tmpDir);
      const sa = tpl.loadouts.get("security-auditor")!;
      const artifacts = generateLoadoutArtifacts(sa);

      expect(artifacts.mcpServers).toHaveLength(1);
      expect(artifacts.mcpServers[0]).toMatchObject({
        name: "ast-grep",
        command: "npx",
      });
      expect(artifacts.mcpServerRefs).toHaveLength(1);
      expect(artifacts.mcpServerRefs[0]).toEqual({
        ref: "@openhive/secrets-scanner",
      });
    });

    it("preserves capabilities after extends-chain merge", () => {
      writeDemoTemplate();
      const tpl = TemplateLoader.load(tmpDir);
      const sa = tpl.loadouts.get("security-auditor")!;
      const artifacts = generateLoadoutArtifacts(sa);
      expect(artifacts.capabilities.sort()).toEqual(
        ["exec.test", "file.read", "git.diff"].sort()
      );
    });

    it("returns permissions with all three lists", () => {
      const lo = resolveStandaloneLoadout({
        name: "t",
        permissions: {
          allow: ["a"],
          deny: ["b"],
          ask: ["c"],
        },
      });
      const artifacts = generateLoadoutArtifacts(lo);
      expect(artifacts.permissions).toEqual({
        allow: ["a"],
        deny: ["b"],
        ask: ["c"],
      });
    });

    it("carries promptAddendum through", () => {
      const lo = resolveStandaloneLoadout({
        name: "t",
        prompt_addendum: "## Hello\nWorld",
      });
      const artifacts = generateLoadoutArtifacts(lo);
      expect(artifacts.promptAddendum).toBe("## Hello\nWorld");
    });
  });

  // ────────────────────────────────────────────────────────────
  // getEffectiveLoadout
  // ────────────────────────────────────────────────────────────

  describe("getEffectiveLoadout", () => {
    it("returns the attached loadout for a role with a slug binding", () => {
      writeDemoTemplate();
      const tpl = TemplateLoader.load(tmpDir);
      const lo = getEffectiveLoadout(tpl, "implementer");
      expect(lo).not.toBeNull();
      expect(lo!.name).toBe("implementer");
      expect(lo!.capabilities).toContain("file.write");
    });

    it("returns the synthetic inline loadout for a role with inline binding", () => {
      writeDemoTemplate();
      const tpl = TemplateLoader.load(tmpDir);
      const lo = getEffectiveLoadout(tpl, "reviewer");
      expect(lo).not.toBeNull();
      expect(lo!.name).toBe("__inline:reviewer");
      expect(lo!.capabilities).toContain("task.update");
    });

    it("returns null when the role has no loadout", () => {
      writeDemoTemplate();
      const tpl = TemplateLoader.load(tmpDir);
      expect(getEffectiveLoadout(tpl, "planner")).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // renderLoadoutYaml
  // ────────────────────────────────────────────────────────────

  describe("renderLoadoutYaml", () => {
    it("emits YAML that omits empty sections", () => {
      const lo = resolveStandaloneLoadout({
        name: "minimal",
        capabilities: ["file.read"],
      });
      const yaml = renderLoadoutYaml(lo);
      expect(yaml).toContain("name: minimal");
      expect(yaml).toContain("capabilities:");
      expect(yaml).not.toContain("permissions:");
      expect(yaml).not.toContain("mcp_servers:");
    });

    it("includes permissions when populated", () => {
      const lo = resolveStandaloneLoadout({
        name: "with-perms",
        permissions: { deny: ["Bash(rm -rf:*)"] },
      });
      const yaml = renderLoadoutYaml(lo);
      expect(yaml).toContain("permissions:");
      expect(yaml).toContain("deny:");
      expect(yaml).toContain("Bash(rm -rf:*)");
    });
  });

  // ────────────────────────────────────────────────────────────
  // listLoadoutConsumers / listInlineLoadoutRoles
  // ────────────────────────────────────────────────────────────

  describe("consumer listing", () => {
    it("maps named loadouts to role consumers, skips inline names", () => {
      writeDemoTemplate();
      const tpl = TemplateLoader.load(tmpDir);
      const consumers = listLoadoutConsumers(tpl);
      expect(consumers.get("implementer")).toEqual(["implementer"]);
      // code-reviewer is only extended, never directly bound → unused
      expect(consumers.get("code-reviewer")).toEqual([]);
      // security-auditor extended via inline, not direct slug → unused
      expect(consumers.get("security-auditor")).toEqual([]);
    });

    it("returns roles bound to inline loadouts separately", () => {
      writeDemoTemplate();
      const tpl = TemplateLoader.load(tmpDir);
      expect(listInlineLoadoutRoles(tpl)).toEqual(["reviewer"]);
    });
  });

  // ────────────────────────────────────────────────────────────
  // agent-prompt integration (promptAddendum wiring)
  // ────────────────────────────────────────────────────────────

  describe("promptAddendum rendering", () => {
    it("appends loadout prompt_addendum to generateAgentPrompt output", () => {
      writeDemoTemplate();
      write(
        "prompts/implementer.md",
        "Write code that matches the existing style."
      );
      const tpl = TemplateLoader.load(tmpDir);
      const { prompt } = generateAgentPrompt(tpl, "implementer");
      expect(prompt).toContain("Write code that matches");
      expect(prompt).toContain("## Implementation Mindset");
      expect(prompt).toContain("Match existing patterns");
    });

    it("appends loadout prompt_addendum to generateRoleSkillMd output", () => {
      writeDemoTemplate();
      write("prompts/implementer.md", "Primary instructions here.");
      const tpl = TemplateLoader.load(tmpDir);
      const { content } = generateRoleSkillMd(tpl, "implementer");
      expect(content).toContain("Primary instructions here");
      expect(content).toContain("## Implementation Mindset");
    });

    it("does not render a Loadout section when role has no loadout", () => {
      writeDemoTemplate();
      write("prompts/planner.md", "Plan well.");
      const tpl = TemplateLoader.load(tmpDir);
      const { prompt } = generateAgentPrompt(tpl, "planner");
      expect(prompt).toContain("Plan well");
      expect(prompt).not.toContain("## Implementation Mindset");
    });
  });

  // ────────────────────────────────────────────────────────────
  // mcpScope artifact + provider helpers
  // ────────────────────────────────────────────────────────────

  describe("mcpScope + providers", () => {
    it("surfaces normalized mcpScope on artifacts", () => {
      const lo = resolveStandaloneLoadout({
        name: "scoped",
        mcp_servers: [
          "opentasks",
          { "ast-grep": ["search"] },
          { "chrome-devtools": { tools: ["navigate"], exclude: ["evaluate"] } },
        ],
      });
      const artifacts = generateLoadoutArtifacts(lo);
      expect(artifacts.mcpScope).toEqual([
        { server: "opentasks", tools: undefined, exclude: undefined },
        { server: "ast-grep", tools: ["search"], exclude: undefined },
        {
          server: "chrome-devtools",
          tools: ["navigate"],
          exclude: ["evaluate"],
        },
      ]);
    });

    it("getMcpProviders returns the template-level map as a plain object", () => {
      writeDemoTemplate();
      // Overlay mcp_providers onto the existing minimal team.yaml
      write(
        "team.yaml",
        `
name: demo
version: 1
roles: [planner, implementer, reviewer]
topology:
  root: { role: planner }
  spawn_rules:
    planner: [implementer, reviewer]
    implementer: []
    reviewer: []
mcp_providers:
  ast-grep:
    command: npx
    args: [ast-grep-mcp]
  filesystem:
    command: fs-mcp
`
      );
      const tpl = TemplateLoader.load(tmpDir);
      const providers = getMcpProviders(tpl);
      expect(Object.keys(providers).sort()).toEqual(["ast-grep", "filesystem"]);
      expect(providers["ast-grep"]).toMatchObject({ command: "npx" });
    });
  });

  describe("findMissingMcpReferences", () => {
    function setup(): void {
      write(
        "team.yaml",
        `
name: demo
version: 1
roles: [worker]
topology:
  root: { role: worker }
mcp_providers:
  opentasks: { command: node, args: [./o.js] }
`
      );
      write("roles/worker.yaml", "name: worker\nloadout: main\n");
      write(
        "loadouts/main.yaml",
        `
name: main
mcp_servers:
  - opentasks
  - chrome-devtools: [navigate]
  - missing-one
`
      );
    }

    it("flags scope references absent from mcp_providers and installed-set", () => {
      setup();
      const tpl = TemplateLoader.load(tmpDir);
      const missing = findMissingMcpReferences(tpl);
      const names = missing.map((m) => m.server).sort();
      expect(names).toEqual(["chrome-devtools", "missing-one"]);
    });

    it("treats consumer-supplied installed-set as satisfying references", () => {
      setup();
      const tpl = TemplateLoader.load(tmpDir);
      const missing = findMissingMcpReferences(tpl, ["chrome-devtools"]);
      expect(missing.map((m) => m.server)).toEqual(["missing-one"]);
    });

    it("returns empty when every scope reference is covered", () => {
      setup();
      const tpl = TemplateLoader.load(tmpDir);
      const missing = findMissingMcpReferences(tpl, [
        "chrome-devtools",
        "missing-one",
      ]);
      expect(missing).toEqual([]);
    });
  });
});
