import { describe, it, expect, vi } from "vitest";
import { FederationState } from "./federation-state";
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
        exports: [{ signal: "PLAN_VALIDATED" }],
      },
    })
  );

  const execution = TemplateLoader.loadFromManifest(
    makeManifest({
      name: "execution",
      roles: ["executor", "debugger"],
      topology: { root: { role: "executor" } },
      communication: {
        channels: {
          incoming_plans: { signals: ["PLAN_RECEIVED"] },
          execution_events: { signals: ["WAVE_COMPLETE"] },
        },
        subscriptions: {
          executor: [{ channel: "incoming_plans" }],
        },
        emissions: { executor: ["WAVE_COMPLETE"] },
        imports: [
          { channel: "incoming_plans", signals: ["PLAN_RECEIVED"] },
        ],
        exports: [{ signal: "WAVE_COMPLETE" }],
      },
    })
  );

  return composeFederation({
    name: "test-federation",
    enforcement: "strict",
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
}

describe("FederationState", () => {
  it("creates TeamState for each team", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);

    expect(state.getTeamKeys()).toEqual(["planning", "execution"]);
    expect(state.getTeam("planning")).toBeDefined();
    expect(state.getTeam("execution")).toBeDefined();
    expect(state.getTeam("unknown")).toBeUndefined();
  });

  it("applies events to the correct team", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);

    state.applyEvent("planning", {
      type: "agent_registered",
      role: "planner",
      label: "planner",
      agentId: "p1",
    });

    const planningTeam = state.getTeam("planning")!;
    expect(planningTeam.getMember("p1")).toBeDefined();
    expect(planningTeam.getMember("p1")!.identity.role).toBe("planner");

    // Execution team unaffected
    const executionTeam = state.getTeam("execution")!;
    expect(executionTeam.getMembers()).toHaveLength(0);
  });

  it("throws on unknown team key", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);

    expect(() =>
      state.applyEvent("unknown", {
        type: "agent_registered",
        role: "x",
        label: "x",
        agentId: "x1",
      })
    ).toThrow(/Unknown team "unknown"/);
  });

  it("validates bridge messages — valid path", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);

    const result = state.validateBridgeMessage(
      "planning",
      "PLAN_VALIDATED",
      "execution",
      "incoming_plans"
    );

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("validates bridge messages — no bridge exists", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);

    const result = state.validateBridgeMessage(
      "execution",
      "WAVE_COMPLETE",
      "planning",
      "planning_events"
    );

    // strict enforcement → error severity → invalid
    expect(result.valid).toBe(false);
    expect(result.violations[0].message).toMatch(/No bridge/);
    expect(result.violations[0].severity).toBe("error");
  });

  it("returns bridges from/to a specific team", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);

    expect(state.getBridgesFrom("planning")).toHaveLength(1);
    expect(state.getBridgesFrom("execution")).toHaveLength(0);
    expect(state.getBridgesTo("execution")).toHaveLength(1);
    expect(state.getBridgesTo("planning")).toHaveLength(0);
  });

  it("emits federation-level state change events", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);
    const events: Array<{ teamKey: string; role: string }> = [];

    state.onStateChange((event) => {
      events.push({
        teamKey: event.teamKey,
        role: event.event.member.identity.role,
      });
    });

    state.applyEvent("planning", {
      type: "agent_registered",
      role: "planner",
      label: "planner",
      agentId: "p1",
    });

    state.applyEvent("execution", {
      type: "agent_registered",
      role: "executor",
      label: "executor",
      agentId: "e1",
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ teamKey: "planning", role: "planner" });
    expect(events[1]).toEqual({ teamKey: "execution", role: "executor" });
  });

  it("unsubscribes listeners", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);
    const listener = vi.fn();

    const unsub = state.onStateChange(listener);

    state.applyEvent("planning", {
      type: "agent_registered",
      role: "planner",
      label: "planner",
      agentId: "p1",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    state.applyEvent("execution", {
      type: "agent_registered",
      role: "executor",
      label: "executor",
      agentId: "e1",
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("produces a federation snapshot", () => {
    const federation = makeFederation();
    const state = new FederationState(federation);

    state.applyEvent("planning", {
      type: "agent_registered",
      role: "planner",
      label: "planner",
      agentId: "p1",
    });

    const snap = state.snapshot();
    expect(snap.name).toBe("test-federation");
    expect(snap.teams.planning.members).toHaveLength(1);
    expect(snap.teams.execution.members).toHaveLength(0);
    expect(snap.teams.planning.roleCounts).toEqual({ planner: 1 });
  });
});
