import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { TemplateLoader } from "./loader";

describe("TemplateLoader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeYaml(relPath: string, content: string): void {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }

  describe("load", () => {
    it("loads a minimal valid template", () => {
      writeYaml(
        "team.yaml",
        `
name: test-team
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      const template = TemplateLoader.load(tmpDir);
      expect(template.manifest.name).toBe("test-team");
      expect(template.manifest.version).toBe(1);
      expect(template.manifest.roles).toEqual(["worker"]);
      expect(template.manifest.topology.root.role).toBe("worker");
      expect(template.roles.size).toBe(1);
      expect(template.roles.get("worker")!.name).toBe("worker");
    });

    it("loads a full self-driving template", () => {
      writeYaml(
        "team.yaml",
        `
name: self-driving
description: "Autonomous codebase development"
version: 1
roles:
  - planner
  - grinder
  - judge
topology:
  root:
    role: planner
    prompt: prompts/planner.md
    config:
      model: sonnet
  companions:
    - role: judge
      prompt: prompts/judge.md
      config:
        model: haiku
  spawn_rules:
    planner: [grinder, planner]
    judge: []
    grinder: []
communication:
  channels:
    task_updates:
      description: "Task lifecycle events"
      signals: [TASK_CREATED, TASK_COMPLETED, TASK_FAILED]
    work_coordination:
      description: "Work assignment"
      signals: [WORK_ASSIGNED, WORKER_DONE]
  subscriptions:
    planner:
      - channel: task_updates
      - channel: work_coordination
        signals: [WORKER_DONE]
    judge:
      - channel: task_updates
        signals: [TASK_FAILED]
    grinder:
      - channel: work_coordination
        signals: [WORK_ASSIGNED]
  emissions:
    planner: [TASK_CREATED, WORK_ASSIGNED]
    judge: [FIXUP_CREATED]
    grinder: [WORKER_DONE]
  routing:
    status: upstream
    peers:
      - from: judge
        to: planner
        via: direct
        signals: [FIXUP_CREATED]
macro_agent:
  task_assignment:
    mode: pull
`
      );

      writeYaml("prompts/planner.md", "# Planner\nYou are the planner.");
      writeYaml("prompts/judge.md", "# Judge\nYou evaluate quality.");

      const template = TemplateLoader.load(tmpDir);
      expect(template.manifest.name).toBe("self-driving");
      expect(template.manifest.roles).toHaveLength(3);
      expect(template.manifest.topology.companions).toHaveLength(1);
      expect(template.manifest.topology.spawn_rules!.planner).toEqual([
        "grinder",
        "planner",
      ]);
      expect(template.manifest.communication!.channels!.task_updates.signals).toEqual([
        "TASK_CREATED",
        "TASK_COMPLETED",
        "TASK_FAILED",
      ]);
      expect(template.prompts.get("planner")!.primary).toContain("You are the planner");
      expect(template.prompts.get("judge")!.primary).toContain("evaluate quality");
      expect(template.manifest.macro_agent).toEqual({
        task_assignment: { mode: "pull" },
      });
    });

    it("loads role definitions from roles/ directory", () => {
      writeYaml(
        "team.yaml",
        `
name: with-roles
version: 1
roles:
  - coder
topology:
  root:
    role: coder
`
      );

      writeYaml(
        "roles/coder.yaml",
        `
name: coder
extends: worker
display_name: "Code Writer"
description: "Writes and tests code"
capabilities:
  add:
    - file.write
    - exec.test
  remove:
    - agent.spawn.worker
macro_agent:
  workspace:
    type: own
`
      );

      const template = TemplateLoader.load(tmpDir);
      const coder = template.roles.get("coder")!;
      expect(coder.displayName).toBe("Code Writer");
      expect(coder.description).toBe("Writes and tests code");
      expect(coder.extends).toBe("worker");
      expect(coder.capabilities).toEqual(["file.write", "exec.test"]);
      expect(coder.raw.macro_agent).toEqual({ workspace: { type: "own" } });
    });

    it("loads role with full capability list", () => {
      writeYaml(
        "team.yaml",
        `
name: simple
version: 1
roles:
  - runner
topology:
  root:
    role: runner
`
      );

      writeYaml(
        "roles/runner.yaml",
        `
name: runner
description: "Task runner"
capabilities:
  - exec.build
  - exec.test
  - exec.lint
`
      );

      const template = TemplateLoader.load(tmpDir);
      expect(template.roles.get("runner")!.capabilities).toEqual([
        "exec.build",
        "exec.test",
        "exec.lint",
      ]);
    });

    it("loads prompts by convention (prompts/<role>.md)", () => {
      writeYaml(
        "team.yaml",
        `
name: conv
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      writeYaml("prompts/worker.md", "# Worker\nDo work.");

      const template = TemplateLoader.load(tmpDir);
      expect(template.prompts.get("worker")!.primary).toContain("Do work");
      expect(template.prompts.get("worker")!.additional).toEqual([]);
    });

    it("loads prompt directory with ROLE.md as primary", () => {
      writeYaml(
        "team.yaml",
        `
name: dir-test
version: 1
roles:
  - developer
topology:
  root:
    role: developer
`
      );

      writeYaml("prompts/developer/ROLE.md", "# Developer\nImplement features.");
      writeYaml("prompts/developer/SOUL.md", "You are a pragmatic craftsman.");
      writeYaml("prompts/developer/RULES.md", "Follow TDD. Write tests first.");

      const template = TemplateLoader.load(tmpDir);
      const prompts = template.prompts.get("developer")!;
      expect(prompts.primary).toContain("Implement features");
      expect(prompts.additional).toHaveLength(2);
      // SOUL.md is always first among additional files
      expect(prompts.additional[0].name).toBe("soul");
      expect(prompts.additional[0].content).toContain("pragmatic craftsman");
      expect(prompts.additional[1].name).toBe("RULES");
    });

    it("orders SOUL.md before other additional files", () => {
      writeYaml(
        "team.yaml",
        `
name: soul-order-test
version: 1
roles:
  - dev
topology:
  root:
    role: dev
`
      );

      writeYaml("prompts/dev/ROLE.md", "Build things.");
      writeYaml("prompts/dev/SOUL.md", "You are creative.");
      writeYaml("prompts/dev/aaa-first-alphabetically.md", "Coding standards.");

      const template = TemplateLoader.load(tmpDir);
      const prompts = template.prompts.get("dev")!;
      expect(prompts.primary).toContain("Build things");
      // SOUL.md should come first despite aaa sorting earlier alphabetically
      expect(prompts.additional[0].name).toBe("soul");
      expect(prompts.additional[1].name).toBe("aaa-first-alphabetically");
    });

    it("falls back to prompt.md when ROLE.md is absent", () => {
      writeYaml(
        "team.yaml",
        `
name: fallback-test
version: 1
roles:
  - tester
topology:
  root:
    role: tester
`
      );

      writeYaml("prompts/tester/prompt.md", "Run all tests.");
      writeYaml("prompts/tester/SOUL.md", "Break things on purpose.");

      const template = TemplateLoader.load(tmpDir);
      const prompts = template.prompts.get("tester")!;
      expect(prompts.primary).toContain("Run all tests");
      expect(prompts.additional).toHaveLength(1);
      expect(prompts.additional[0].name).toBe("soul");
    });

    it("uses first file alphabetically when neither ROLE.md nor prompt.md exist", () => {
      writeYaml(
        "team.yaml",
        `
name: alpha-test
version: 1
roles:
  - tester
topology:
  root:
    role: tester
`
      );

      writeYaml("prompts/tester/instructions.md", "Run all tests.");
      writeYaml("prompts/tester/SOUL.md", "Break things on purpose.");

      const template = TemplateLoader.load(tmpDir);
      const prompts = template.prompts.get("tester")!;
      // SOUL.md sorts before instructions.md (uppercase < lowercase in ASCII)
      // so SOUL.md is picked as primary in the alphabetical fallback
      expect(prompts.primary).toContain("Break things on purpose");
      expect(prompts.additional).toHaveLength(1);
      expect(prompts.additional[0].name).toBe("instructions");
    });

    it("respects explicit prompts ordering from role YAML", () => {
      writeYaml(
        "team.yaml",
        `
name: ordered-test
version: 1
roles:
  - coder
topology:
  root:
    role: coder
`
      );

      writeYaml(
        "roles/coder.yaml",
        `
name: coder
description: "A coder"
prompts:
  - SOUL.md
  - ROLE.md
  - RULES.md
`
      );

      writeYaml("prompts/coder/ROLE.md", "Write code.");
      writeYaml("prompts/coder/SOUL.md", "You are meticulous.");
      writeYaml("prompts/coder/RULES.md", "Use TypeScript.");

      const template = TemplateLoader.load(tmpDir);
      const prompts = template.prompts.get("coder")!;
      // SOUL.md is first in the list, so it becomes primary
      expect(prompts.primary).toContain("meticulous");
      expect(prompts.additional).toHaveLength(2);
      expect(prompts.additional[0].name).toBe("ROLE");
      expect(prompts.additional[1].name).toBe("RULES");
    });

    it("prefers prompt directory over single file", () => {
      writeYaml(
        "team.yaml",
        `
name: priority-test
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      // Both exist — directory should win
      writeYaml("prompts/worker.md", "Single file prompt.");
      writeYaml("prompts/worker/ROLE.md", "Directory prompt.");
      writeYaml("prompts/worker/SOUL.md", "Directory soul.");

      const template = TemplateLoader.load(tmpDir);
      const prompts = template.prompts.get("worker")!;
      expect(prompts.primary).toContain("Directory prompt");
      expect(prompts.additional).toHaveLength(1);
      expect(prompts.additional[0].name).toBe("soul");
    });
  });

  describe("validation", () => {
    it("throws when team.yaml is missing", () => {
      expect(() => TemplateLoader.load(tmpDir)).toThrow("team.yaml not found");
    });

    it("throws when name is missing", () => {
      writeYaml(
        "team.yaml",
        `
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow("missing required field: name");
    });

    it("throws when roles list is empty", () => {
      writeYaml(
        "team.yaml",
        `
name: bad
version: 1
roles: []
topology:
  root:
    role: worker
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow("at least one role");
    });

    it("throws when topology.root.role is not in roles", () => {
      writeYaml(
        "team.yaml",
        `
name: bad
version: 1
roles:
  - worker
topology:
  root:
    role: unknown
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'topology.root.role "unknown" is not in the roles list'
      );
    });

    it("throws when companion role is not in roles", () => {
      writeYaml(
        "team.yaml",
        `
name: bad
version: 1
roles:
  - worker
topology:
  root:
    role: worker
  companions:
    - role: ghost
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'topology.companions role "ghost" is not in the roles list'
      );
    });

    it("throws when spawn_rules reference unknown role", () => {
      writeYaml(
        "team.yaml",
        `
name: bad
version: 1
roles:
  - worker
topology:
  root:
    role: worker
  spawn_rules:
    worker: [ghost]
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'spawn_rules "worker" references unknown role "ghost"'
      );
    });

    it("accepts spawn_rules with object entries (max_instances)", () => {
      writeYaml(
        "team.yaml",
        `
name: spawn-obj
version: 1
roles:
  - orchestrator
  - worker
  - monitor
topology:
  root:
    role: orchestrator
  spawn_rules:
    orchestrator:
      - role: worker
        max_instances: 5
      - monitor
    worker: []
    monitor: []
`
      );

      const template = TemplateLoader.load(tmpDir);
      const rules = template.manifest.topology.spawn_rules!;
      expect(rules.orchestrator).toHaveLength(2);
      expect(rules.orchestrator[0]).toEqual({ role: "worker", max_instances: 5 });
      expect(rules.orchestrator[1]).toBe("monitor");
    });

    it("throws when spawn_rules object entry references unknown role", () => {
      writeYaml(
        "team.yaml",
        `
name: bad-obj
version: 1
roles:
  - worker
topology:
  root:
    role: worker
  spawn_rules:
    worker:
      - role: ghost
        max_instances: 3
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'spawn_rules "worker" references unknown role "ghost"'
      );
    });

    it("throws when max_instances is zero", () => {
      writeYaml(
        "team.yaml",
        `
name: bad-max
version: 1
roles:
  - lead
  - worker
topology:
  root:
    role: lead
  spawn_rules:
    lead:
      - role: worker
        max_instances: 0
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'invalid max_instances'
      );
    });

    it("throws when max_instances is negative", () => {
      writeYaml(
        "team.yaml",
        `
name: bad-neg
version: 1
roles:
  - lead
  - worker
topology:
  root:
    role: lead
  spawn_rules:
    lead:
      - role: worker
        max_instances: -1
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'invalid max_instances'
      );
    });

    it("throws when subscription references unknown channel", () => {
      writeYaml(
        "team.yaml",
        `
name: bad
version: 1
roles:
  - worker
topology:
  root:
    role: worker
communication:
  channels: {}
  subscriptions:
    worker:
      - channel: nonexistent
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'references unknown channel "nonexistent"'
      );
    });

    it("throws when subscription role is not in roles", () => {
      writeYaml(
        "team.yaml",
        `
name: bad
version: 1
roles:
  - worker
topology:
  root:
    role: worker
communication:
  channels:
    ch1:
      signals: [SIG]
  subscriptions:
    ghost:
      - channel: ch1
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'subscriptions key "ghost" is not in the roles list'
      );
    });

    it("throws when peer route references unknown role", () => {
      writeYaml(
        "team.yaml",
        `
name: bad
version: 1
roles:
  - worker
topology:
  root:
    role: worker
communication:
  routing:
    peers:
      - from: worker
        to: ghost
        via: direct
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'routing.peers.to "ghost" is not in the roles list'
      );
    });
  });

  describe("role inheritance", () => {
    it("resolves single-level inheritance with add/remove", () => {
      writeYaml(
        "team.yaml",
        `
name: inherit-test
version: 1
roles:
  - senior
  - junior
topology:
  root:
    role: senior
`
      );

      writeYaml(
        "roles/senior.yaml",
        `
name: senior
capabilities:
  - code
  - review
  - deploy
`
      );

      writeYaml(
        "roles/junior.yaml",
        `
name: junior
extends: senior
capabilities:
  add:
    - code
    - debug
  remove:
    - deploy
`
      );

      const template = TemplateLoader.load(tmpDir);
      const junior = template.roles.get("junior")!;
      expect(junior.capabilities.sort()).toEqual(["code", "debug", "review"]);
    });

    it("resolves multi-level inheritance (A extends B extends C)", () => {
      writeYaml(
        "team.yaml",
        `
name: multi-inherit
version: 1
roles:
  - base
  - mid
  - leaf
topology:
  root:
    role: base
`
      );

      writeYaml(
        "roles/base.yaml",
        `
name: base
capabilities:
  - read
  - write
  - admin
`
      );

      writeYaml(
        "roles/mid.yaml",
        `
name: mid
extends: base
capabilities:
  add:
    - build
  remove:
    - admin
`
      );

      writeYaml(
        "roles/leaf.yaml",
        `
name: leaf
extends: mid
capabilities:
  add:
    - deploy
  remove:
    - write
`
      );

      const template = TemplateLoader.load(tmpDir);
      // base: [read, write, admin]
      // mid:  base + build - admin = [read, write, build]
      // leaf: mid + deploy - write = [read, build, deploy]
      expect(template.roles.get("mid")!.capabilities.sort()).toEqual(
        ["build", "read", "write"]
      );
      expect(template.roles.get("leaf")!.capabilities.sort()).toEqual(
        ["build", "deploy", "read"]
      );
    });

    it("keeps explicit capability array as override (no merge)", () => {
      writeYaml(
        "team.yaml",
        `
name: override-test
version: 1
roles:
  - parent
  - child
topology:
  root:
    role: parent
`
      );

      writeYaml(
        "roles/parent.yaml",
        `
name: parent
capabilities:
  - a
  - b
  - c
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: parent
capabilities:
  - x
  - y
`
      );

      const template = TemplateLoader.load(tmpDir);
      // Plain array = explicit override, not merged with parent
      expect(template.roles.get("child")!.capabilities).toEqual(["x", "y"]);
    });

    it("detects circular inheritance", () => {
      writeYaml(
        "team.yaml",
        `
name: cycle-test
version: 1
roles:
  - alpha
  - beta
topology:
  root:
    role: alpha
`
      );

      writeYaml(
        "roles/alpha.yaml",
        `
name: alpha
extends: beta
capabilities:
  add:
    - a
`
      );

      writeYaml(
        "roles/beta.yaml",
        `
name: beta
extends: alpha
capabilities:
  add:
    - b
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        "Circular role inheritance detected"
      );
    });

    it("resolves flat capabilities_add/capabilities_remove syntax", () => {
      writeYaml(
        "team.yaml",
        `
name: flat-syntax
version: 1
roles:
  - base
  - child
topology:
  root:
    role: base
`
      );

      writeYaml(
        "roles/base.yaml",
        `
name: base
capabilities:
  - read
  - write
  - admin
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: base
capabilities_add:
  - debug
  - test
capabilities_remove:
  - admin
`
      );

      const template = TemplateLoader.load(tmpDir);
      const child = template.roles.get("child")!;
      expect(child.capabilities.sort()).toEqual(["debug", "read", "test", "write"]);
    });

    it("resolves flat capabilities_add only (no remove)", () => {
      writeYaml(
        "team.yaml",
        `
name: add-only
version: 1
roles:
  - parent
  - child
topology:
  root:
    role: parent
`
      );

      writeYaml(
        "roles/parent.yaml",
        `
name: parent
capabilities:
  - a
  - b
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: parent
capabilities_add:
  - c
`
      );

      const template = TemplateLoader.load(tmpDir);
      expect(template.roles.get("child")!.capabilities.sort()).toEqual(["a", "b", "c"]);
    });

    it("resolves flat capabilities_remove only (no add)", () => {
      writeYaml(
        "team.yaml",
        `
name: remove-only
version: 1
roles:
  - parent
  - child
topology:
  root:
    role: parent
`
      );

      writeYaml(
        "roles/parent.yaml",
        `
name: parent
capabilities:
  - a
  - b
  - c
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: parent
capabilities_remove:
  - c
`
      );

      const template = TemplateLoader.load(tmpDir);
      expect(template.roles.get("child")!.capabilities.sort()).toEqual(["a", "b"]);
    });

    it("errors when both CapabilityComposition and flat fields are used", () => {
      writeYaml(
        "team.yaml",
        `
name: conflict
version: 1
roles:
  - bad
topology:
  root:
    role: bad
`
      );

      writeYaml(
        "roles/bad.yaml",
        `
name: bad
capabilities:
  add:
    - x
  remove:
    - y
capabilities_add:
  - z
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'uses both CapabilityComposition'
      );
    });

    it("ignores extends when parent is not in roles map", () => {
      writeYaml(
        "team.yaml",
        `
name: external-parent
version: 1
roles:
  - child
topology:
  root:
    role: child
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: nonexistent-parent
capabilities:
  add:
    - foo
    - bar
`
      );

      // Parent not in roles map → just use add list as-is
      const template = TemplateLoader.load(tmpDir);
      expect(template.roles.get("child")!.capabilities).toEqual(["foo", "bar"]);
      expect(template.roles.get("child")!.extends).toBe("nonexistent-parent");
    });
  });

  describe("capability map form", () => {
    it("parses map form with null and object values", () => {
      writeYaml(
        "team.yaml",
        `
name: map-test
version: 1
roles:
  - agent
topology:
  root:
    role: agent
`
      );

      writeYaml(
        "roles/agent.yaml",
        `
name: agent
description: "Agent with map capabilities"
capabilities:
  file.read: null
  file.write: null
  lifecycle.ephemeral:
    max_duration: 3600
`
      );

      const template = TemplateLoader.load(tmpDir);
      const agent = template.roles.get("agent")!;
      expect(agent.capabilities.sort()).toEqual([
        "file.read",
        "file.write",
        "lifecycle.ephemeral",
      ]);
      expect(agent.capabilityConfig).toEqual({
        "file.read": null,
        "file.write": null,
        "lifecycle.ephemeral": { max_duration: 3600 },
      });
    });

    it("map form overrides parent capabilities (no merge)", () => {
      writeYaml(
        "team.yaml",
        `
name: map-override
version: 1
roles:
  - parent
  - child
topology:
  root:
    role: parent
`
      );

      writeYaml(
        "roles/parent.yaml",
        `
name: parent
capabilities:
  - a
  - b
  - c
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: parent
capabilities:
  x.one: null
  y.two:
    level: high
`
      );

      const template = TemplateLoader.load(tmpDir);
      const child = template.roles.get("child")!;
      // Map form = explicit override, not merged with parent
      expect(child.capabilities.sort()).toEqual(["x.one", "y.two"]);
      expect(child.capabilityConfig).toEqual({
        "x.one": null,
        "y.two": { level: "high" },
      });
    });

    it("inherits capabilityConfig from parent via composition add/remove", () => {
      writeYaml(
        "team.yaml",
        `
name: config-inherit
version: 1
roles:
  - parent
  - child
topology:
  root:
    role: parent
`
      );

      writeYaml(
        "roles/parent.yaml",
        `
name: parent
capabilities:
  file.read: null
  file.write:
    mode: async
  admin.deploy:
    env: production
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: parent
capabilities:
  add:
    - debug
  remove:
    - admin.deploy
`
      );

      const template = TemplateLoader.load(tmpDir);
      const child = template.roles.get("child")!;
      // parent: [file.read, file.write, admin.deploy] + debug - admin.deploy
      expect(child.capabilities.sort()).toEqual(["debug", "file.read", "file.write"]);
      // Config inherited for retained capabilities
      expect(child.capabilityConfig).toEqual({
        "file.read": null,
        "file.write": { mode: "async" },
      });
    });

    it("empty map form produces empty capabilities", () => {
      writeYaml(
        "team.yaml",
        `
name: empty-map
version: 1
roles:
  - agent
topology:
  root:
    role: agent
`
      );

      writeYaml(
        "roles/agent.yaml",
        `
name: agent
capabilities: {}
`
      );

      const template = TemplateLoader.load(tmpDir);
      const agent = template.roles.get("agent")!;
      expect(agent.capabilities).toEqual([]);
      expect(agent.capabilityConfig).toEqual({});
    });

    it("errors when map form is combined with flat fields", () => {
      writeYaml(
        "team.yaml",
        `
name: conflict
version: 1
roles:
  - bad
topology:
  root:
    role: bad
`
      );

      writeYaml(
        "roles/bad.yaml",
        `
name: bad
capabilities:
  file.read: null
capabilities_add:
  - extra
`
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow(
        'uses both CapabilityComposition'
      );
    });
  });

  describe("load with options (hooks)", () => {
    it("resolves external parent via resolveExternalRole hook", () => {
      writeYaml(
        "team.yaml",
        `
name: hook-test
version: 1
roles:
  - child
topology:
  root:
    role: child
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: external-worker
capabilities:
  add:
    - debug
  remove:
    - git.push
`
      );

      const template = TemplateLoader.load(tmpDir, {
        resolveExternalRole: (name) => {
          if (name === "external-worker") {
            return {
              name: "external-worker",
              displayName: "Worker",
              description: "External worker role",
              capabilities: ["file.read", "file.write", "git.push"],
              raw: { name: "external-worker" },
            };
          }
          return null;
        },
      });

      const child = template.roles.get("child")!;
      // parent: [file.read, file.write, git.push] + debug - git.push
      expect(child.capabilities.sort()).toEqual(["debug", "file.read", "file.write"]);
    });

    it("external resolver returning null falls back to add-only", () => {
      writeYaml(
        "team.yaml",
        `
name: null-resolver
version: 1
roles:
  - orphan
topology:
  root:
    role: orphan
`
      );

      writeYaml(
        "roles/orphan.yaml",
        `
name: orphan
extends: nonexistent
capabilities:
  add:
    - foo
`
      );

      const template = TemplateLoader.load(tmpDir, {
        resolveExternalRole: () => null,
      });

      // No parent found → just the add list
      expect(template.roles.get("orphan")!.capabilities).toEqual(["foo"]);
    });

    it("postProcessRole transforms each role", () => {
      writeYaml(
        "team.yaml",
        `
name: post-process
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      writeYaml(
        "roles/worker.yaml",
        `
name: worker
capabilities:
  - build
`
      );

      const template = TemplateLoader.load(tmpDir, {
        postProcessRole: (role) => ({
          ...role,
          capabilities: [...role.capabilities, "injected.cap"],
        }),
      });

      expect(template.roles.get("worker")!.capabilities).toEqual([
        "build",
        "injected.cap",
      ]);
    });

    it("postProcess transforms the entire template", () => {
      writeYaml(
        "team.yaml",
        `
name: full-post
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      const template = TemplateLoader.load(tmpDir, {
        postProcess: (t) => ({
          ...t,
          sourcePath: "/overridden",
        }),
      });

      expect(template.sourcePath).toBe("/overridden");
    });
  });

  describe("loadAsync", () => {
    it("loads template with async external resolver", async () => {
      writeYaml(
        "team.yaml",
        `
name: async-test
version: 1
roles:
  - child
topology:
  root:
    role: child
`
      );

      writeYaml(
        "roles/child.yaml",
        `
name: child
extends: async-parent
capabilities:
  add:
    - test
`
      );

      const template = await TemplateLoader.loadAsync(tmpDir, {
        resolveExternalRole: async (name) => {
          // Simulate async lookup
          await new Promise((r) => setTimeout(r, 1));
          if (name === "async-parent") {
            return {
              name: "async-parent",
              displayName: "Async Parent",
              description: "Resolved asynchronously",
              capabilities: ["read", "write"],
              raw: { name: "async-parent" },
            };
          }
          return null;
        },
      });

      const child = template.roles.get("child")!;
      expect(child.capabilities.sort()).toEqual(["read", "test", "write"]);
    });

    it("loads without options (same as sync)", async () => {
      writeYaml(
        "team.yaml",
        `
name: async-basic
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      const template = await TemplateLoader.loadAsync(tmpDir);
      expect(template.manifest.name).toBe("async-basic");
      expect(template.roles.get("worker")!.name).toBe("worker");
    });

    it("supports async postProcessRole", async () => {
      writeYaml(
        "team.yaml",
        `
name: async-post
version: 1
roles:
  - dev
topology:
  root:
    role: dev
`
      );

      const template = await TemplateLoader.loadAsync(tmpDir, {
        postProcessRole: async (role) => {
          await new Promise((r) => setTimeout(r, 1));
          return { ...role, capabilities: [...role.capabilities, "async.cap"] };
        },
      });

      expect(template.roles.get("dev")!.capabilities).toContain("async.cap");
    });

    it("supports async postProcess", async () => {
      writeYaml(
        "team.yaml",
        `
name: async-post-full
version: 1
roles:
  - dev
topology:
  root:
    role: dev
`
      );

      const template = await TemplateLoader.loadAsync(tmpDir, {
        postProcess: async (t) => {
          await new Promise((r) => setTimeout(r, 1));
          return { ...t, sourcePath: "/async-overridden" };
        },
      });

      expect(template.sourcePath).toBe("/async-overridden");
    });
  });

  describe("MCP server loading", () => {
    it("loads tools/mcp-servers.json per role", () => {
      writeYaml(
        "team.yaml",
        `
name: mcp-test
version: 1
roles:
  - planner
  - worker
topology:
  root:
    role: planner
`
      );

      const mcpConfig = {
        planner: {
          servers: [
            { name: "sudocode", command: "npx", args: ["sudocode-mcp"] },
          ],
        },
        worker: {
          servers: [
            { name: "linter", command: "eslint-mcp", env: { CI: "true" } },
            { name: "tester", command: "vitest-mcp" },
          ],
        },
      };
      const toolsDir = path.join(tmpDir, "tools");
      fs.mkdirSync(toolsDir, { recursive: true });
      fs.writeFileSync(
        path.join(toolsDir, "mcp-servers.json"),
        JSON.stringify(mcpConfig),
        "utf-8"
      );

      const template = TemplateLoader.load(tmpDir);
      expect(template.mcpServers.size).toBe(2);
      expect(template.mcpServers.get("planner")).toHaveLength(1);
      expect(template.mcpServers.get("planner")![0].name).toBe("sudocode");
      expect(template.mcpServers.get("worker")).toHaveLength(2);
      expect(template.mcpServers.get("worker")![0].env).toEqual({ CI: "true" });
    });

    it("returns empty map when tools/ does not exist", () => {
      writeYaml(
        "team.yaml",
        `
name: no-tools
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      const template = TemplateLoader.load(tmpDir);
      expect(template.mcpServers.size).toBe(0);
    });

    it("throws on malformed JSON", () => {
      writeYaml(
        "team.yaml",
        `
name: bad-json
version: 1
roles:
  - worker
topology:
  root:
    role: worker
`
      );

      const toolsDir = path.join(tmpDir, "tools");
      fs.mkdirSync(toolsDir, { recursive: true });
      fs.writeFileSync(
        path.join(toolsDir, "mcp-servers.json"),
        "{ invalid json",
        "utf-8"
      );

      expect(() => TemplateLoader.load(tmpDir)).toThrow("Failed to parse");
    });
  });

  describe("loadFromManifest", () => {
    it("loads from an inline manifest", () => {
      const template = TemplateLoader.loadFromManifest({
        name: "inline",
        version: 1,
        roles: ["worker"],
        topology: { root: { role: "worker" } },
      });

      expect(template.manifest.name).toBe("inline");
      expect(template.roles.get("worker")!.name).toBe("worker");
      expect(template.mcpServers.size).toBe(0);
      expect(template.sourcePath).toBe("");
    });
  });
});
