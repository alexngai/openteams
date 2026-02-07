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
      expect(template.prompts.get("planner")).toContain("You are the planner");
      expect(template.prompts.get("judge")).toContain("evaluate quality");
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
      expect(template.prompts.get("worker")).toContain("Do work");
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
      expect(template.sourcePath).toBe("");
    });
  });
});
