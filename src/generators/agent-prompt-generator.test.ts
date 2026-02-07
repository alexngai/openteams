import { describe, it, expect } from "vitest";
import { TemplateLoader } from "../template/loader";
import {
  generateAgentPrompts,
  generateAgentPrompt,
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
