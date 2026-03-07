import { describe, it, expect } from "vitest";
import { TemplateLoader } from "../template/loader";
import { generateSkillMd, generateCatalog } from "./skill-generator";
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

  it("includes YAML frontmatter when enabled", () => {
    const md = generateSkillMd(makeFullTemplate(), {
      includeFrontmatter: true,
    });
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("name: self-driving");
    expect(md).toContain("description: Autonomous codebase development");
    expect(md).toContain("roles: [planner, grinder, judge]");
    expect(md).toContain("root: planner");
    expect(md).toContain("\n---\n");
  });

  it("omits frontmatter by default", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).not.toMatch(/^---\n/);
  });

  it("includes spawn rules by default", () => {
    const md = generateSkillMd(makeFullTemplate());
    expect(md).toContain("## Spawn Rules");
    expect(md).toContain("Respect spawn rules");
  });

  it("omits spawn rules section when includeSpawnRules is false", () => {
    const md = generateSkillMd(makeFullTemplate(), {
      includeSpawnRules: false,
    });
    expect(md).not.toContain("## Spawn Rules");
  });

  it("omits spawn rules guideline when includeSpawnRules is false", () => {
    const md = generateSkillMd(makeFullTemplate(), {
      includeSpawnRules: false,
    });
    expect(md).not.toContain("Respect spawn rules");
  });

  it("still includes other guidelines when spawn rules disabled", () => {
    const md = generateSkillMd(makeFullTemplate(), {
      includeSpawnRules: false,
    });
    expect(md).toContain("## Agent Interaction Guidelines");
    expect(md).toContain("Check the task board regularly");
  });
});

describe("generateCatalog", () => {
  it("includes team name and description", () => {
    const catalog = generateCatalog(makeFullTemplate());
    expect(catalog).toContain("# Team: self-driving");
    expect(catalog).toContain("> Autonomous codebase development");
  });

  it("generates roles table with positions", () => {
    const catalog = generateCatalog(makeFullTemplate());
    expect(catalog).toContain("| Role | Description | Position |");
    expect(catalog).toContain("| planner |");
    expect(catalog).toContain("| root |");
    expect(catalog).toContain("| judge |");
    expect(catalog).toContain("| companion |");
    expect(catalog).toContain("| grinder |");
    expect(catalog).toContain("| spawned |");
  });

  it("includes role loading instructions", () => {
    const catalog = generateCatalog(makeFullTemplate());
    expect(catalog).toContain("## Loading a role");
    expect(catalog).toContain("`roles/planner/SKILL.md`");
    expect(catalog).toContain("`roles/grinder/SKILL.md`");
    expect(catalog).toContain("`roles/judge/SKILL.md`");
  });

  it("respects team name override", () => {
    const catalog = generateCatalog(makeFullTemplate(), {
      teamName: "my-project",
    });
    expect(catalog).toContain("# Team: my-project");
  });

  it("works with minimal template", () => {
    const catalog = generateCatalog(makeMinimalTemplate());
    expect(catalog).toContain("# Team: test-team");
    expect(catalog).toContain("| lead |");
    expect(catalog).toContain("| root |");
    expect(catalog).toContain("| worker |");
    expect(catalog).toContain("| spawned |");
  });
});
