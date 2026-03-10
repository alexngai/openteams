import { describe, it, expect } from "vitest";
import { composeFederation } from "./federation-loader";
import { TemplateLoader } from "./loader";
import type { TeamManifest } from "./types";

function makeManifest(overrides: Partial<TeamManifest> = {}): TeamManifest {
  return {
    name: "test-team",
    version: 1,
    roles: ["lead", "worker"],
    topology: { root: { role: "lead" } },
    ...overrides,
  };
}

describe("composeFederation", () => {
  it("composes two teams with a valid bridge", () => {
    const planning = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "planning",
        roles: ["planner", "checker"],
        topology: { root: { role: "planner" } },
        communication: {
          channels: {
            planning_events: { signals: ["PLAN_READY", "PLAN_VALIDATED"] },
          },
          emissions: { checker: ["PLAN_VALIDATED"] },
          exports: [{ signal: "PLAN_VALIDATED" }],
        },
      })
    );

    const execution = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "execution",
        roles: ["executor", "verifier"],
        topology: { root: { role: "executor" } },
        communication: {
          channels: {
            incoming_plans: { signals: ["PLAN_RECEIVED"] },
            execution_events: { signals: ["WAVE_COMPLETE"] },
          },
          subscriptions: {
            executor: [{ channel: "incoming_plans" }],
          },
          imports: [
            { channel: "incoming_plans", signals: ["PLAN_RECEIVED"] },
          ],
        },
      })
    );

    const federation = composeFederation({
      name: "test-federation",
      teams: {
        planning: { template: planning },
        execution: { template: execution },
      },
      bridges: [
        {
          from: { team: "planning", signal: "PLAN_VALIDATED" },
          to: { team: "execution", channel: "incoming_plans", signal: "PLAN_RECEIVED" },
        },
      ],
    });

    expect(federation.manifest.name).toBe("test-federation");
    expect(federation.teams.size).toBe(2);
    expect(federation.bridges).toHaveLength(1);
  });

  it("rejects bridge referencing unexported signal", () => {
    const planning = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "planning",
        roles: ["planner"],
        topology: { root: { role: "planner" } },
        communication: {
          channels: { events: { signals: ["PLAN_READY"] } },
          emissions: { planner: ["PLAN_READY"] },
          exports: [{ signal: "PLAN_READY" }],
        },
      })
    );

    const execution = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "execution",
        roles: ["executor"],
        topology: { root: { role: "executor" } },
        communication: {
          channels: { incoming: { signals: ["PLAN_RECEIVED"] } },
          subscriptions: { executor: [{ channel: "incoming" }] },
          imports: [{ channel: "incoming", signals: ["PLAN_RECEIVED"] }],
        },
      })
    );

    expect(() =>
      composeFederation({
        name: "test",
        teams: {
          planning: { template: planning },
          execution: { template: execution },
        },
        bridges: [
          {
            from: { team: "planning", signal: "NONEXISTENT" },
            to: { team: "execution", channel: "incoming", signal: "PLAN_RECEIVED" },
          },
        ],
      })
    ).toThrow(/not exported by team "planning"/);
  });

  it("rejects bridge targeting non-imported channel", () => {
    const source = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "source",
        roles: ["emitter"],
        topology: { root: { role: "emitter" } },
        communication: {
          channels: { events: { signals: ["SIGNAL_A"] } },
          emissions: { emitter: ["SIGNAL_A"] },
          exports: [{ signal: "SIGNAL_A" }],
        },
      })
    );

    const dest = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "dest",
        roles: ["receiver"],
        topology: { root: { role: "receiver" } },
        communication: {
          channels: { real_channel: { signals: ["SIGNAL_B"] } },
          subscriptions: { receiver: [{ channel: "real_channel" }] },
          imports: [{ channel: "real_channel", signals: ["SIGNAL_B"] }],
        },
      })
    );

    expect(() =>
      composeFederation({
        name: "test",
        teams: { source: { template: source }, dest: { template: dest } },
        bridges: [
          {
            from: { team: "source", signal: "SIGNAL_A" },
            to: { team: "dest", channel: "wrong_channel", signal: "SIGNAL_B" },
          },
        ],
      })
    ).toThrow(/not imported by team "dest"/);
  });

  it("rejects bridge targeting channel with no subscribers", () => {
    const source = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "source",
        roles: ["emitter"],
        topology: { root: { role: "emitter" } },
        communication: {
          channels: { events: { signals: ["SIG"] } },
          emissions: { emitter: ["SIG"] },
        },
      })
    );

    const dest = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "dest",
        roles: ["receiver"],
        topology: { root: { role: "receiver" } },
        communication: {
          channels: { incoming: { signals: ["SIG"] } },
          subscriptions: {},  // no one subscribes
        },
      })
    );

    expect(() =>
      composeFederation({
        name: "test",
        teams: { source: { template: source }, dest: { template: dest } },
        bridges: [
          {
            from: { team: "source", signal: "SIG" },
            to: { team: "dest", channel: "incoming", signal: "SIG" },
          },
        ],
      })
    ).toThrow(/no subscribed roles/);
  });

  it("allows bridges without exports/imports (open teams)", () => {
    const source = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "source",
        roles: ["emitter"],
        topology: { root: { role: "emitter" } },
        communication: {
          channels: { events: { signals: ["SIG"] } },
          emissions: { emitter: ["SIG"] },
        },
      })
    );

    const dest = TemplateLoader.loadFromManifest(
      makeManifest({
        name: "dest",
        roles: ["receiver"],
        topology: { root: { role: "receiver" } },
        communication: {
          channels: { incoming: { signals: ["SIG"] } },
          subscriptions: { receiver: [{ channel: "incoming" }] },
        },
      })
    );

    // No exports/imports declared — bridges still work
    const federation = composeFederation({
      name: "open-federation",
      teams: { source: { template: source }, dest: { template: dest } },
      bridges: [
        {
          from: { team: "source", signal: "SIG" },
          to: { team: "dest", channel: "incoming", signal: "SIG" },
        },
      ],
    });

    expect(federation.bridges).toHaveLength(1);
  });

  it("supports federation with no bridges", () => {
    const teamA = TemplateLoader.loadFromManifest(makeManifest({ name: "a" }));
    const teamB = TemplateLoader.loadFromManifest(makeManifest({ name: "b" }));

    const federation = composeFederation({
      name: "no-bridges",
      teams: {
        a: { template: teamA },
        b: { template: teamB },
      },
    });

    expect(federation.bridges).toHaveLength(0);
    expect(federation.teams.size).toBe(2);
  });

  it("preserves placement config", () => {
    const team = TemplateLoader.loadFromManifest(makeManifest({ name: "a" }));

    const federation = composeFederation({
      name: "placed",
      teams: {
        a: {
          template: team,
          placement: { zone: "edge", replicas: 3 },
        },
      },
    });

    expect(federation.manifest.teams.a.placement?.zone).toBe("edge");
    expect(federation.manifest.teams.a.placement?.replicas).toBe(3);
  });
});
