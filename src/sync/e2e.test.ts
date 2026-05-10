/**
 * End-to-end tests for the OpenTeams sync surface.
 *
 * These exercise the full publisher → wire → consumer flow against the
 * real `examples/loadout-demo` template, covering:
 *
 *   - bundle → JSON.stringify → JSON.parse → hydrate round-trips
 *   - generator output equivalence (a hydrated template feeds existing
 *     generators identically to a directly-loaded one)
 *   - TeamState integration with a hydrated team
 *   - embedded-vs-standalone loadout id equivalence across a wire transfer
 *   - spawn dispatch round-trip through MAP task meta + JSON
 *   - validators on intact and tampered bundles
 *   - tampering detection on hydrate
 *
 * The loadout-demo template serves as the worked example: every test
 * starts from `TemplateLoader.load(LOADOUT_DEMO_DIR)`.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";

import { TemplateLoader } from "../template/loader";
import { generateSkillMd, generateCatalog } from "../generators/skill-generator";
import { generateLoadoutArtifacts } from "../generators/loadout-generator";
import { TeamState } from "../runtime/team-state";

import {
  bundleLoadout,
  bundleTeam,
  computeLoadoutId,
  computeTeamId,
  hydrateBundle,
  hydrateLoadout,
  verifyHash,
  verifyTeamHash,
} from "./bundle";
import {
  decodeSpawnTaskMeta,
  encodeSpawnTaskMeta,
} from "./spawn";
import {
  formatRef,
  loadoutRef,
  parseRef,
  teamRef,
} from "./uri";
import {
  validateLoadoutBundle,
  validateTeamBundle,
} from "./validate";
import {
  LOADOUT_RESOURCE_TYPE,
  SPAWN_KIND,
  TEAM_RESOURCE_TYPE,
  type LoadoutResource,
  type SpawnRequest,
  type TeamResource,
} from "./types";

const LOADOUT_DEMO_DIR = path.resolve(__dirname, "../../examples/loadout-demo");

function loadDemo() {
  return TemplateLoader.load(LOADOUT_DEMO_DIR);
}

/** Simulate a wire transfer via JSON — what consumers actually receive. */
function wireTransfer<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─────────────────────────────────────────────────────────────
// Loadout: publisher → wire → consumer
// ─────────────────────────────────────────────────────────────

describe("e2e: loadout publish + fetch", () => {
  it("survives JSON serialization and reconstructs an equal ResolvedLoadout", () => {
    // Publisher
    const template = loadDemo();
    const reviewer = template.loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, {
      version: "1.0.0",
      name: "code-reviewer",
      description: "Baseline reviewer",
      tags: ["review"],
    });

    // Wire (JSON over the network)
    const received: LoadoutResource = wireTransfer(bundle);

    // Consumer
    expect(received.id).toBe(bundle.id);
    expect(received.type).toBe(LOADOUT_RESOURCE_TYPE);
    expect(verifyHash(received)).toBe(true);

    const hydrated = hydrateLoadout(received);
    expect(hydrated).toEqual(reviewer);
  });

  it("two publishers on the same template produce identical bundles", () => {
    const a = bundleLoadout(loadDemo().loadouts.get("code-reviewer")!, {
      version: "1.0.0",
      name: "code-reviewer",
      timestamp: "2026-01-01T00:00:00Z",
      ownerId: "publisher-a",
    });
    const b = bundleLoadout(loadDemo().loadouts.get("code-reviewer")!, {
      version: "9.9.9",                       // different version label
      name: "code-reviewer",
      timestamp: "2099-12-31T00:00:00Z",      // different timestamp
      ownerId: "publisher-b",                 // different owner
    });
    expect(a.id).toBe(b.id);                  // same content ⇒ same id
  });

  it("validates clean against the template's declared MCP providers", () => {
    const template = loadDemo();
    const reviewer = template.loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });
    const installed = Array.from(template.mcpProviders.keys());

    const result = validateLoadoutBundle(bundle, { installedMcpServers: installed });
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Team: publisher → wire → consumer
// ─────────────────────────────────────────────────────────────

describe("e2e: team publish + fetch", () => {
  it("hydrates back to a ResolvedTemplate equivalent to direct loading", () => {
    const original = loadDemo();
    const bundle = bundleTeam(original, { version: "1.0.0" });

    // Wire
    const received: TeamResource = wireTransfer(bundle);

    expect(verifyTeamHash(received)).toBe(true);

    const hydrated = hydrateBundle(received);
    expect(hydrated.manifest).toEqual(original.manifest);
    expect(Array.from(hydrated.roles.entries())).toEqual(
      Array.from(original.roles.entries())
    );
    expect(Array.from(hydrated.loadouts.entries())).toEqual(
      Array.from(original.loadouts.entries())
    );
    expect(Array.from(hydrated.mcpProviders.entries())).toEqual(
      Array.from(original.mcpProviders.entries())
    );
  });

  it("feeds existing generators identically to a directly-loaded template", () => {
    const original = loadDemo();
    const hydrated = hydrateBundle(wireTransfer(bundleTeam(original, { version: "1.0.0" })));

    // Several generators, all data-driven over ResolvedTemplate
    expect(generateSkillMd(hydrated)).toBe(generateSkillMd(original));
    expect(generateCatalog(hydrated)).toBe(generateCatalog(original));

    // Loadout-level generator works on each role's loadout
    for (const [name, lo] of hydrated.loadouts) {
      const fromHydrated = generateLoadoutArtifacts(lo);
      const fromOriginal = generateLoadoutArtifacts(original.loadouts.get(name)!);
      expect(fromHydrated).toEqual(fromOriginal);
    }
  });

  it("validates clean for a self-consistent team", () => {
    const bundle = bundleTeam(loadDemo(), { version: "1.0.0" });
    const result = validateTeamBundle(wireTransfer(bundle));
    expect(result.valid).toBe(true);
    expect(result.violations.filter((v) => v.severity === "error")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Embedded vs standalone equivalence — across the wire
// ─────────────────────────────────────────────────────────────

describe("e2e: embedded loadout id matches standalone, even after JSON transfer", () => {
  it("for every loadout in the demo template", () => {
    const template = loadDemo();
    const teamBundle = wireTransfer(bundleTeam(template, { version: "1.0.0" }));

    expect(Object.keys(teamBundle.metadata.loadouts).length).toBeGreaterThan(0);

    for (const [name, embedded] of Object.entries(teamBundle.metadata.loadouts)) {
      const resolved = template.loadouts.get(name);
      if (!resolved) throw new Error(`loadout not found: ${name}`);

      const standalone = wireTransfer(
        bundleLoadout(resolved, { version: "1.0.0", name })
      );

      // Same id
      expect(embedded.id).toBe(standalone.id);

      // Hydrating either path produces equal ResolvedLoadout
      expect(embedded.resolved).toEqual(hydrateLoadout(standalone));
    }
  });
});

// ─────────────────────────────────────────────────────────────
// TeamState: hydrated bundle drives the runtime layer
// ─────────────────────────────────────────────────────────────

describe("e2e: hydrated team feeds TeamState", () => {
  it("constructs a TeamState and processes member events", () => {
    const bundle = wireTransfer(bundleTeam(loadDemo(), { version: "1.0.0" }));
    const hydrated = hydrateBundle(bundle);

    const state = new TeamState(hydrated.manifest.name, hydrated);

    // Pick any role from the manifest and register an agent under it
    const [firstRole] = hydrated.manifest.roles;
    if (!firstRole) throw new Error("expected at least one role");

    state.applyEvent({
      type: "agent_registered",
      role: firstRole,
      agentId: "agent_1",
      label: `${firstRole}-1`,
    });
    state.applyEvent({
      type: "agent_state_changed",
      agentId: "agent_1",
      status: "idle",
    });

    const snap = state.snapshot();
    expect(snap.teamName).toBe(hydrated.manifest.name);
    expect(snap.members.length).toBe(1);
    expect(snap.members[0]!.identity.role).toBe(firstRole);
    expect(snap.members[0]!.status).toBe("idle");
    expect(snap.roleCounts[firstRole]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Spawn dispatch — full round-trip through MAP task meta + JSON
// ─────────────────────────────────────────────────────────────

describe("e2e: spawn dispatch round-trip", () => {
  it("orchestrator → MAP task meta → JSON → worker → decoded SpawnRequest", () => {
    // Orchestrator side: derive refs from a real bundled team + loadout
    const template = loadDemo();
    const teamBundle = bundleTeam(template, { version: "1.0.0" });
    const reviewerBundle = bundleLoadout(
      template.loadouts.get("code-reviewer")!,
      { version: "1.0.0", name: "code-reviewer" }
    );

    const req: SpawnRequest = {
      loadout: loadoutRef(reviewerBundle.id),
      team: teamRef(teamBundle.id),
      role: "code-reviewer",
      label: "reviewer-1",
      target: { runtime: "claude-code", placement: { zone: "edge" } },
      parent: "orchestrator-1",
    };

    // Wire format: a MAP task with our typed meta
    const taskOnTheWire = JSON.stringify({
      id: "spawn-task-1",
      status: "open",
      meta: encodeSpawnTaskMeta(req),
    });

    // Worker side
    const task = JSON.parse(taskOnTheWire);
    expect(task.meta.kind).toBe(SPAWN_KIND);

    const decoded = decodeSpawnTaskMeta(task.meta);
    expect(decoded).toEqual(req);

    // Worker resolves the loadout ref and fetches the loadout
    const ref = parseRef(decoded!.loadout);
    expect(ref?.type).toBe(LOADOUT_RESOURCE_TYPE);
    expect(ref?.id).toBe(reviewerBundle.id);

    // (In a real consumer: mapClient.call("map/resources/get", { type, id })
    // returns a LoadoutResource; here we just assert the round-trip holds.)
    expect(formatRef(ref!)).toBe(req.loadout);
  });

  it("worker rejects malformed task meta without throwing", () => {
    expect(decodeSpawnTaskMeta({ kind: "openteams.other" })).toBeNull();
    expect(decodeSpawnTaskMeta({ kind: SPAWN_KIND })).toBeNull();
    expect(decodeSpawnTaskMeta(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Tampering detection along the wire
// ─────────────────────────────────────────────────────────────

describe("e2e: tampering detection", () => {
  it("hydrate throws and validate reports an error for a tampered loadout", () => {
    const reviewer = loadDemo().loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    // Tamper after JSON wire transfer (simulate a malicious middleman)
    const json = JSON.stringify(bundle);
    const received = JSON.parse(json) as LoadoutResource;
    received.metadata.resolved.capabilities.push("evil.escalation");

    expect(verifyHash(received)).toBe(false);
    expect(() => hydrateLoadout(received)).toThrow(/hash mismatch/);

    const validation = validateLoadoutBundle(received);
    expect(validation.valid).toBe(false);
    expect(validation.violations.some(
      (v) => v.severity === "error" && v.message.includes("hash mismatch")
    )).toBe(true);
  });

  it("hydrate throws when an embedded loadout in a team is tampered with", () => {
    const template = loadDemo();
    const bundle = bundleTeam(template, { version: "1.0.0" });
    const json = JSON.stringify(bundle);
    const received = JSON.parse(json) as TeamResource;

    const [firstName] = Object.keys(received.metadata.loadouts);
    if (!firstName) throw new Error("expected at least one loadout");
    received.metadata.loadouts[firstName]!.resolved.capabilities.push("evil.cap");

    // Re-sign the team-level hash so the team check passes — only the
    // embedded loadout check should catch this.
    received.id = computeTeamId(received.name, received.metadata);

    expect(() => hydrateBundle(received)).toThrow(/Embedded loadout .+ hash mismatch/);
  });

  it("validators are pure — running them does not mutate the resource", () => {
    const bundle = bundleTeam(loadDemo(), { version: "1.0.0" });
    const before = JSON.stringify(bundle);
    validateTeamBundle(bundle);
    expect(JSON.stringify(bundle)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────
// Hash invariants — the contract publishers and consumers rely on
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Worked example: the walkthrough script must run cleanly
// ─────────────────────────────────────────────────────────────

describe("e2e: walkthrough script", () => {
  it("runs to completion and reports all steps green", async () => {
    const { execSync } = await import("node:child_process");
    const script = path.resolve(__dirname, "../../examples/sync-walkthrough/walkthrough.ts");
    const stdout = execSync(`npx tsx ${script}`, {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });

    // Each section header
    expect(stdout).toContain("Publisher loads and bundles");
    expect(stdout).toContain("Embedded loadout ids match standalone ids");
    expect(stdout).toContain("Wire transfer (JSON serialization)");
    expect(stdout).toContain("Consumer validates and hydrates");
    expect(stdout).toContain("Spawn dispatch round-trip");
    expect(stdout).toContain("Tampering detection");

    // Key invariants observed in the script's output
    expect(stdout).toContain("matches: true");           // wire-transfer id match
    expect(stdout).toContain("Team validation:    valid=true");
    expect(stdout).toContain("Decoded matches:    true");
    expect(stdout).toContain("Tampered loadout:   valid=false");
    expect(stdout).toContain("hydrate threw");

    // No "✗" markers — every embedded/standalone pair lined up
    expect(stdout).not.toContain("✗");

    expect(stdout).toContain("Walkthrough complete.");
  }, 30000);
});

describe("e2e: hash invariants", () => {
  it("bundling the same template twice produces identical ids", () => {
    const a = bundleTeam(loadDemo(), { version: "1.0.0" });
    const b = bundleTeam(loadDemo(), { version: "1.0.0" });
    expect(a.id).toBe(b.id);
  });

  it("changing a loadout's content changes the team id", () => {
    const a = bundleTeam(loadDemo(), { version: "1.0.0" });

    const tweakedTemplate = loadDemo();
    const reviewer = tweakedTemplate.loadouts.get("code-reviewer")!;
    reviewer.capabilities = [...reviewer.capabilities, "added.cap"];

    const b = bundleTeam(tweakedTemplate, { version: "1.0.0" });
    expect(a.id).not.toBe(b.id);
  });

  it("standalone bundleLoadout id is computeLoadoutId of its content", () => {
    const reviewer = loadDemo().loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });
    const expected = computeLoadoutId("code-reviewer", {
      bundleVersion: 1,
      resolved: reviewer,
    });
    expect(bundle.id).toBe(expected);
  });
});
