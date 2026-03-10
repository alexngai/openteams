import { describe, it, expect } from "vitest";
import { generateFederatedSkillMd, generateBridgeContext } from "./federation-generator";
import { composeFederation } from "../template/federation-loader";
import { TemplateLoader } from "../template/loader";
import type { TeamManifest } from "../template/types";

function makeManifest(overrides: Partial<TeamManifest> = {}): TeamManifest {
  return {
    name: "test",
    version: 1,
    roles: ["lead", "worker"],
    topology: { root: { role: "lead" } },
    ...overrides,
  };
}

function makeFederation() {
  const planning = TemplateLoader.loadFromManifest(
    makeManifest({
      name: "planning",
      roles: ["planner", "checker"],
      topology: { root: { role: "planner" } },
      communication: {
        channels: {
          planning_events: { signals: ["PLAN_VALIDATED"] },
        },
        emissions: { checker: ["PLAN_VALIDATED"] },
        exports: [
          { signal: "PLAN_VALIDATED", description: "Plan has been validated" },
        ],
      },
    })
  );

  const execution = TemplateLoader.loadFromManifest(
    makeManifest({
      name: "execution",
      roles: ["executor"],
      topology: { root: { role: "executor" } },
      communication: {
        channels: {
          incoming_plans: { signals: ["PLAN_RECEIVED"] },
        },
        subscriptions: {
          executor: [{ channel: "incoming_plans" }],
        },
        imports: [
          {
            channel: "incoming_plans",
            signals: ["PLAN_RECEIVED"],
            description: "Plans from external planning team",
          },
        ],
      },
    })
  );

  return composeFederation({
    name: "test-federation",
    enforcement: "audit",
    teams: {
      planning: { template: planning, placement: { zone: "central" } },
      execution: { template: execution, placement: { zone: "edge", replicas: 3 } },
    },
    bridges: [
      {
        from: { team: "planning", signal: "PLAN_VALIDATED" },
        to: { team: "execution", channel: "incoming_plans", signal: "PLAN_RECEIVED" },
      },
    ],
  });
}

describe("generateFederatedSkillMd", () => {
  it("generates a federation skill document", () => {
    const federation = makeFederation();
    const md = generateFederatedSkillMd(federation);

    expect(md).toContain("# Federation: test-federation");
    expect(md).toContain("Enforcement: **audit**");
    expect(md).toContain("## Teams");
    expect(md).toContain("planning");
    expect(md).toContain("execution");
  });

  it("includes team boundaries", () => {
    const federation = makeFederation();
    const md = generateFederatedSkillMd(federation);

    expect(md).toContain("## Team Boundaries");
    expect(md).toContain("**Exports:**");
    expect(md).toContain("`PLAN_VALIDATED`");
    expect(md).toContain("Plan has been validated");
    expect(md).toContain("**Imports:**");
    expect(md).toContain("`incoming_plans`");
  });

  it("includes bridges table", () => {
    const federation = makeFederation();
    const md = generateFederatedSkillMd(federation);

    expect(md).toContain("## Bridges");
    expect(md).toContain("| planning | PLAN_VALIDATED | execution | incoming_plans | PLAN_RECEIVED |");
  });

  it("includes signal flow diagram", () => {
    const federation = makeFederation();
    const md = generateFederatedSkillMd(federation);

    expect(md).toContain("## Signal Flow");
    expect(md).toContain(
      "planning --[PLAN_VALIDATED → PLAN_RECEIVED]--> execution (incoming_plans)"
    );
  });

  it("includes placement zones in teams table", () => {
    const federation = makeFederation();
    const md = generateFederatedSkillMd(federation);

    expect(md).toContain("| planning | planning | 2 | central |");
    expect(md).toContain("| execution | execution | 1 | edge |");
  });

  it("respects options to exclude sections", () => {
    const federation = makeFederation();
    const md = generateFederatedSkillMd(federation, {
      includeBoundaries: false,
      includeBridges: false,
    });

    expect(md).not.toContain("## Team Boundaries");
    expect(md).not.toContain("## Bridges");
    // Signal flow still included since bridges exist
    expect(md).toContain("## Signal Flow");
  });
});

describe("generateBridgeContext", () => {
  it("generates inbound context for a team", () => {
    const federation = makeFederation();
    const ctx = generateBridgeContext(federation, "execution");

    expect(ctx).toContain("## Cross-Team Signals");
    expect(ctx).toContain("receives signals from external teams");
    expect(ctx).toContain("**PLAN_RECEIVED**");
    expect(ctx).toContain("from the planning team");
  });

  it("generates outbound context for a team", () => {
    const federation = makeFederation();
    const ctx = generateBridgeContext(federation, "planning");

    expect(ctx).toContain("exports signals to other teams");
    expect(ctx).toContain("**PLAN_VALIDATED**");
    expect(ctx).toContain("consumed by the execution team");
  });

  it("returns empty string for team with no bridges", () => {
    const teamA = TemplateLoader.loadFromManifest(makeManifest({ name: "a" }));
    const teamB = TemplateLoader.loadFromManifest(makeManifest({ name: "b" }));

    const federation = composeFederation({
      name: "no-bridges",
      teams: { a: { template: teamA }, b: { template: teamB } },
    });

    expect(generateBridgeContext(federation, "a")).toBe("");
    expect(generateBridgeContext(federation, "b")).toBe("");
  });
});
