import { describe, it, expect } from "vitest";
import { TemplateLoader } from "../template/loader";
import { generateSkillMd } from "./skill-generator";
import type { TeamManifest, ResolvedTemplate } from "../template/types";

function makeMinimalTemplate(): ResolvedTemplate {
  const manifest: TeamManifest = {
    name: "test-team",
    version: 1,
    roles: ["lead", "worker"],
    topology: {
      root: { role: "lead" },
    },
  };
  return TemplateLoader.loadFromManifest(manifest);
}

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
        status: "upstream",
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

describe("generateSkillMd", () => {
  it("generates header with team name", () => {
    const md = generateSkillMd(makeMinimalTemplate());
    expect(md).toContain("# Team: test-team");
  });

  it("includes description when present", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("> Autonomous codebase development");
  });

  it("generates team structure section", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("## Team Structure");
    expect(md).toContain("**Root**: planner (model: sonnet)");
    expect(md).toContain("**Companions**: judge");
    expect(md).toContain("planner, grinder, judge");
  });

  it("generates roles section", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("## Roles");
    expect(md).toContain("### planner");
    expect(md).toContain("### grinder");
    expect(md).toContain("### judge");
  });

  it("generates channels table", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("### Channels");
    expect(md).toContain("| task_updates |");
    expect(md).toContain("TASK_CREATED, TASK_COMPLETED, TASK_FAILED");
    expect(md).toContain("| work_coordination |");
  });

  it("generates subscriptions table", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("### Subscriptions");
    expect(md).toContain("| planner | task_updates | all |");
    expect(md).toContain("| planner | work_coordination | WORKER_DONE |");
    expect(md).toContain("| judge | task_updates | TASK_FAILED |");
    expect(md).toContain("| grinder | work_coordination | WORK_ASSIGNED |");
  });

  it("generates emission permissions table", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("### Emission Permissions");
    expect(md).toContain("| planner | TASK_CREATED, WORK_ASSIGNED |");
    expect(md).toContain("| grinder | WORKER_DONE |");
  });

  it("generates peer routes table", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("### Peer Routes");
    expect(md).toContain("| judge | planner | direct | FIXUP_CREATED |");
  });

  it("generates spawn rules table", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("## Spawn Rules");
    expect(md).toContain("| planner | grinder, planner |");
    expect(md).toContain("| judge | (none) |");
    expect(md).toContain("| grinder | (none) |");
  });

  it("generates interaction guidelines with CLI examples", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("## Agent Interaction Guidelines");
    expect(md).toContain("openteams task list self-driving");
    expect(md).toContain("openteams message send self-driving");
    expect(md).toContain("openteams template emit self-driving");
    expect(md).toContain("openteams template events self-driving");
  });

  it("respects team name override", () => {
    const md = generateSkillMd(makeFullTemplate(), {
      teamName: "my-project",
    });
    expect(md).toContain("# Team: my-project");
    expect(md).toContain("openteams task list my-project");
  });

  it("omits CLI examples when disabled", () => {
    const md = generateSkillMd(makeFullTemplate(), {
      includeCliExamples: false,
    });
    expect(md).not.toContain("```bash");
  });

  it("omits communication section when no communication config", () => {
    const md = generateSkillMd(makeMinimalTemplate());
    expect(md).not.toContain("## Communication");
  });

  it("omits spawn rules section when none defined", () => {
    const md = generateSkillMd(makeMinimalTemplate());
    expect(md).not.toContain("## Spawn Rules");
  });

  it("shows enforcement mode", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("Enforcement: **strict**");
    expect(md).toContain("Unauthorized emissions will be rejected");
  });

  it("shows status routing when present", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("### Status Routing: **upstream**");
  });
});
