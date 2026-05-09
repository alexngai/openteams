import { describe, it, expect } from "vitest";
import * as path from "node:path";

import { TemplateLoader } from "../template/loader";
import { bundleLoadout, bundleTeam, computeTeamId } from "./bundle";
import { validateLoadoutBundle, validateTeamBundle } from "./validate";
import type { LoadoutResource, TeamResource } from "./types";

const LOADOUT_DEMO_DIR = path.resolve(__dirname, "../../examples/loadout-demo");

function loadDemoTemplate() {
  return TemplateLoader.load(LOADOUT_DEMO_DIR);
}

function declaredMcpServers(): string[] {
  // Servers declared in the demo template's manifest providers.
  // Used as the consumer-installed set for loadout-only validation.
  const template = loadDemoTemplate();
  return Array.from(template.mcpProviders.keys());
}

describe("validateLoadoutBundle", () => {
  it("is valid for an intact bundle with all scope refs satisfied", () => {
    const template = loadDemoTemplate();
    const reviewer = template.loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });
    const result = validateLoadoutBundle(bundle, {
      installedMcpServers: declaredMcpServers(),
    });
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("reports an error violation when the hash is tampered with", () => {
    const reviewer = loadDemoTemplate().loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });
    const tampered: LoadoutResource = { ...bundle, id: "sha256:" + "0".repeat(64) };

    const result = validateLoadoutBundle(tampered, {
      installedMcpServers: declaredMcpServers(),
    });
    expect(result.valid).toBe(false);
    expect(result.violations.some(
      (v) => v.severity === "error" && v.message.includes("hash mismatch")
    )).toBe(true);
  });

  it("warns when scope references a server that is neither installed nor in the loadout", () => {
    const reviewer = loadDemoTemplate().loadouts.get("code-reviewer")!;
    const bundle = bundleLoadout(reviewer, { version: "1.0.0", name: "code-reviewer" });

    // Empty installed set — the demo loadout's scope (`ast-grep`) won't resolve
    const result = validateLoadoutBundle(bundle, { installedMcpServers: [] });
    expect(result.valid).toBe(true); // warnings only, no errors
    expect(result.violations.some(
      (v) => v.severity === "warning" && v.message.includes("ast-grep")
    )).toBe(true);
  });

  it("treats loadout-installed servers as available even without an installed set", () => {
    const template = loadDemoTemplate();
    // implementer has an inline install spec, not just scope
    const implementer = template.loadouts.get("implementer");
    if (!implementer) return; // skip if demo doesn't have it

    const bundle = bundleLoadout(implementer, { version: "1.0.0", name: "implementer" });
    const result = validateLoadoutBundle(bundle, { installedMcpServers: [] });

    // any warnings should not be about servers the loadout itself installs
    const installNames = new Set(
      implementer.mcpServers.filter((e): e is { name: string } => "name" in e).map((e) => e.name)
    );
    for (const v of result.violations) {
      for (const n of installNames) {
        expect(v.message.includes(n)).toBe(false);
      }
    }
  });
});

describe("validateTeamBundle", () => {
  it("is valid for an intact bundle with no missing MCP refs", () => {
    const template = loadDemoTemplate();
    const bundle = bundleTeam(template, { version: "1.0.0" });
    const result = validateTeamBundle(bundle);

    // demo template self-resolves: manifest providers cover its scope refs
    expect(result.valid).toBe(true);
    const errors = result.violations.filter((v) => v.severity === "error");
    expect(errors).toEqual([]);
  });

  it("reports an error when the team hash is tampered with", () => {
    const bundle = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    const tampered: TeamResource = { ...bundle, id: "sha256:" + "0".repeat(64) };
    const result = validateTeamBundle(tampered);
    expect(result.valid).toBe(false);
    expect(result.violations.some(
      (v) => v.severity === "error" && v.message.includes("Team hash mismatch")
    )).toBe(true);
  });

  it("reports an error when an embedded loadout hash is tampered with", () => {
    const template = loadDemoTemplate();
    const bundle = bundleTeam(template, { version: "1.0.0" });
    const [firstName] = Object.keys(bundle.metadata.loadouts);
    if (!firstName) throw new Error("expected at least one loadout");

    const original = bundle.metadata.loadouts[firstName]!;
    const tampered: TeamResource = {
      ...bundle,
      metadata: {
        ...bundle.metadata,
        loadouts: {
          ...bundle.metadata.loadouts,
          [firstName]: {
            ...original,
            resolved: {
              ...original.resolved,
              capabilities: [...original.resolved.capabilities, "extra.cap"],
            },
          },
        },
      },
    };
    // Recompute team hash so the team-level check passes — we want
    // the embedded-loadout check to surface.
    tampered.id = computeTeamId(tampered.name, tampered.metadata);

    const result = validateTeamBundle(tampered);
    expect(result.valid).toBe(false);
    expect(result.violations.some(
      (v) => v.severity === "error" && v.message.includes("Embedded loadout")
    )).toBe(true);
  });

  it("does not run MCP scope checks when hashes are invalid", () => {
    const bundle = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    const tampered: TeamResource = { ...bundle, id: "sha256:" + "0".repeat(64) };
    const result = validateTeamBundle(tampered);
    // No warning-severity violations should appear since we short-circuit
    expect(result.violations.every((v) => v.severity === "error")).toBe(true);
  });

  it("propagates installed-set into MCP scope resolution", () => {
    const template = loadDemoTemplate();
    const bundle = bundleTeam(template, { version: "1.0.0" });
    // Pass a bogus extra installed name — should not affect validity since
    // the team is already self-consistent
    const result = validateTeamBundle(bundle, {
      installedMcpServers: ["extra-server-xyz"],
    });
    expect(result.valid).toBe(true);
  });
});
