import { describe, it, expect } from "vitest";
import { TemplateLoader } from "../template/loader";
import {
  generateAgentPrompts,
  generateAgentPrompt,
  generateRoleSkillMd,
  generateAllRoleSkillMds,
} from "./agent-prompt-generator";
import type { TeamManifest, ResolvedTemplate } from "../template/types";

function makeFullTemplate(): ResolvedTemplate {
  const manifest: TeamManifest = {
    name: "self-driving",
    description: "Autonomous codebase development",
    version: 1,
    roles: ["planner", "grinder", "judge"],
    topology: {
      root: {
        role: "planner",
        config: { model: "sonnet" },
      },
      companions: [{ role: "judge" }],
      spawn_rules: {
        planner: ["grinder", "planner"],
        judge: [],
        grinder: [],
      },
    },
    communication: {
      enforcement: "strict",
      channels: {
        task_updates: {
          description: "Task lifecycle events",
          signals: ["TASK_CREATED", "TASK_COMPLETED", "TASK_FAILED"],
        },
        work_coordination: {
          signals: ["WORK_ASSIGNED", "WORKER_DONE"],
        },
      },
      subscriptions: {
        planner: [
          { channel: "task_updates" },
          { channel: "work_coordination", signals: ["WORKER_DONE"] },
        ],
        judge: [{ channel: "task_updates", signals: ["TASK_FAILED"] }],
        grinder: [
          { channel: "work_coordination", signals: ["WORK_ASSIGNED"] },
        ],
      },
      emissions: {
        planner: ["TASK_CREATED", "WORK_ASSIGNED"],
        grinder: ["WORKER_DONE"],
      },
      routing: {
        peers: [
          {
            from: "judge",
            to: "planner",
            via: "direct",
            signals: ["FIXUP_CREATED"],
          },
        ],
      },
    },
  };
  return TemplateLoader.loadFromManifest(manifest);
}

describe("generateAgentPrompts", () => {
  it("generates a prompt for each role", () => {
    const prompts = generateAgentPrompts(makeFullTemplate());
    expect(prompts).toHaveLength(3);
    expect(prompts.map((p) => p.role).sort()).toEqual([
      "grinder",
      "judge",
      "planner",
    ]);
  });

  it("respects team name override", () => {
    const prompts = generateAgentPrompts(makeFullTemplate(), {
      teamName: "my-project",
    });
    for (const prompt of prompts) {
      expect(prompt.prompt).toContain("my-project");
    }
  });

  it("includes preamble when provided", () => {
    const prompts = generateAgentPrompts(makeFullTemplate(), {
      preamble: "IMPORTANT: Always use TypeScript.",
    });
    for (const prompt of prompts) {
      expect(prompt.prompt).toContain("IMPORTANT: Always use TypeScript.");
    }
  });
});

describe("generateAgentPrompt (single role)", () => {
  it("generates a prompt for a specific role", () => {
    const prompt = generateAgentPrompt(makeFullTemplate(), "planner");
    expect(prompt.role).toBe("planner");
    expect(prompt.prompt).toContain("# Role: planner");
  });
});

describe("planner prompt", () => {
  const prompt = generateAgentPrompts(makeFullTemplate()).find(
    (p) => p.role === "planner"
  )!;

  it("identifies as root agent", () => {
    expect(prompt.prompt).toContain("**root agent** (team lead)");
  });

  it("lists teammates", () => {
    expect(prompt.prompt).toContain("grinder, judge");
  });

  it("shows subscriptions", () => {
    expect(prompt.prompt).toContain("**task_updates**: all signals");
    expect(prompt.prompt).toContain("**work_coordination**: WORKER_DONE");
  });

  it("shows emission permissions", () => {
    expect(prompt.prompt).toContain("You can emit:");
    expect(prompt.prompt).toContain("TASK_CREATED, WORK_ASSIGNED");
  });

  it("shows spawn permissions", () => {
    expect(prompt.prompt).toContain("You can spawn: **grinder, planner**");
  });

  it("shows incoming peer route from judge", () => {
    expect(prompt.prompt).toContain("Direct routes (incoming):");
    expect(prompt.prompt).toContain("From **judge** via direct");
  });

  it("includes CLI quick reference", () => {
    expect(prompt.prompt).toContain("## CLI Quick Reference");
    expect(prompt.prompt).toContain("openteams task list self-driving");
  });
});

describe("judge prompt", () => {
  const prompt = generateAgentPrompts(makeFullTemplate()).find(
    (p) => p.role === "judge"
  )!;

  it("identifies as companion agent", () => {
    expect(prompt.prompt).toContain("**companion agent** to the root (planner)");
  });

  it("shows TASK_FAILED subscription only", () => {
    expect(prompt.prompt).toContain("**task_updates**: TASK_FAILED");
  });

  it("cannot spawn other agents", () => {
    expect(prompt.prompt).toContain("**cannot** spawn other agents");
  });

  it("shows outgoing peer route to planner", () => {
    expect(prompt.prompt).toContain("Direct routes (outgoing):");
    expect(prompt.prompt).toContain("To **planner** via direct");
  });
});

describe("grinder prompt", () => {
  const prompt = generateAgentPrompts(makeFullTemplate()).find(
    (p) => p.role === "grinder"
  )!;

  it("identifies as spawned agent", () => {
    expect(prompt.prompt).toContain("**spawned agent**");
  });

  it("shows WORK_ASSIGNED subscription", () => {
    expect(prompt.prompt).toContain("**work_coordination**: WORK_ASSIGNED");
  });

  it("shows WORKER_DONE emission", () => {
    expect(prompt.prompt).toContain("WORKER_DONE");
  });

  it("cannot spawn other agents", () => {
    expect(prompt.prompt).toContain("**cannot** spawn other agents");
  });
});

describe("minimal template", () => {
  it("handles template with no communication config", () => {
    const manifest: TeamManifest = {
      name: "minimal",
      version: 1,
      roles: ["lead", "worker"],
      topology: { root: { role: "lead" } },
    };
    const template = TemplateLoader.loadFromManifest(manifest);
    const prompts = generateAgentPrompts(template);
    expect(prompts).toHaveLength(2);

    const lead = prompts.find((p) => p.role === "lead")!;
    expect(lead.prompt).toContain("# Role: lead");
    expect(lead.prompt).toContain("**root agent**");
    expect(lead.prompt).toContain(
      "No spawn rules defined — spawning is permissive"
    );
    // No communication section
    expect(lead.prompt).not.toContain("## Communication");
  });
});

describe("generateRoleSkillMd", () => {
  it("generates YAML frontmatter", () => {
    const result = generateRoleSkillMd(makeFullTemplate(), "planner");
    expect(result.role).toBe("planner");
    expect(result.content).toMatch(/^---\n/);
    expect(result.content).toContain("name: self-driving/planner");
    expect(result.content).toContain("role: planner");
    expect(result.content).toContain("team: self-driving");
    expect(result.content).toContain("position: root");
    expect(result.content).toContain("\n---\n");
  });

  it("includes frontmatter with communication summary", () => {
    const result = generateRoleSkillMd(makeFullTemplate(), "planner");
    expect(result.content).toContain(
      "subscribes: [task_updates, work_coordination]"
    );
    expect(result.content).toContain(
      "emits: [TASK_CREATED, WORK_ASSIGNED]"
    );
    expect(result.content).toContain(
      "can_spawn: [grinder, planner]"
    );
  });

  it("identifies position correctly for each role type", () => {
    const planner = generateRoleSkillMd(makeFullTemplate(), "planner");
    expect(planner.content).toContain("position: root");
    expect(planner.content).toContain("Position: **root** (team lead)");

    const judge = generateRoleSkillMd(makeFullTemplate(), "judge");
    expect(judge.content).toContain("position: companion");
    expect(judge.content).toContain("Position: **companion**");

    const grinder = generateRoleSkillMd(makeFullTemplate(), "grinder");
    expect(grinder.content).toContain("position: spawned");
    expect(grinder.content).toContain("Position: **spawned** agent");
  });

  it("uses agent-agnostic communication headings", () => {
    const result = generateRoleSkillMd(makeFullTemplate(), "planner");
    expect(result.content).toContain("### Subscriptions");
    expect(result.content).toContain("### Can Emit");
    // Should NOT use Claude-specific phrasing
    expect(result.content).not.toContain("You receive events from:");
    expect(result.content).not.toContain("You can emit:");
  });

  it("includes communication details", () => {
    const planner = generateRoleSkillMd(makeFullTemplate(), "planner");
    expect(planner.content).toContain("**task_updates**: all signals");
    expect(planner.content).toContain("**work_coordination**: WORKER_DONE");
    expect(planner.content).toContain("TASK_CREATED, WORK_ASSIGNED");
  });

  it("includes peer routes", () => {
    const judge = generateRoleSkillMd(makeFullTemplate(), "judge");
    expect(judge.content).toContain("### Peer Routes (outgoing)");
    expect(judge.content).toContain("To **planner** via direct");

    const planner = generateRoleSkillMd(makeFullTemplate(), "planner");
    expect(planner.content).toContain("### Peer Routes (incoming)");
    expect(planner.content).toContain("From **judge** via direct");
  });

  it("includes teammates", () => {
    const result = generateRoleSkillMd(makeFullTemplate(), "planner");
    expect(result.content).toContain("## Teammates");
    expect(result.content).toContain("grinder, judge");
  });

  it("includes CLI reference", () => {
    const result = generateRoleSkillMd(makeFullTemplate(), "planner");
    expect(result.content).toContain("## CLI Quick Reference");
    expect(result.content).toContain("openteams task list self-driving");
  });

  it("respects team name override", () => {
    const result = generateRoleSkillMd(makeFullTemplate(), "planner", {
      teamName: "my-project",
    });
    expect(result.content).toContain("name: my-project/planner");
    expect(result.content).toContain("team: my-project");
    expect(result.content).toContain("**my-project** team");
  });

  it("handles minimal template without communication", () => {
    const manifest: TeamManifest = {
      name: "minimal",
      version: 1,
      roles: ["lead", "worker"],
      topology: { root: { role: "lead" } },
    };
    const template = TemplateLoader.loadFromManifest(manifest);
    const result = generateRoleSkillMd(template, "lead");
    expect(result.content).toContain("name: minimal/lead");
    expect(result.content).toContain("position: root");
    expect(result.content).not.toContain("## Communication");
  });
});

describe("generateAllRoleSkillMds", () => {
  it("generates a skill md for each role", () => {
    const results = generateAllRoleSkillMds(makeFullTemplate());
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.role).sort()).toEqual([
      "grinder",
      "judge",
      "planner",
    ]);
  });

  it("each result has content with frontmatter", () => {
    const results = generateAllRoleSkillMds(makeFullTemplate());
    for (const result of results) {
      expect(result.content).toMatch(/^---\n/);
      expect(result.content).toContain(`role: ${result.role}`);
    }
  });
});
