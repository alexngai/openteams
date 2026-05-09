import { describe, it, expect } from "vitest";
import * as path from "node:path";

import { TemplateLoader } from "../template/loader";
import type { ResolvedLoadout, ResolvedTemplate } from "../template/types";
import {
  bundleLoadout,
  bundleTeam,
  canonicalize,
  computeLoadoutId,
  computeTeamId,
  hash,
  hydrateBundle,
  hydrateLoadout,
  verifyHash,
  verifyTeamHash,
} from "./bundle";
import { LOADOUT_RESOURCE_TYPE, TEAM_RESOURCE_TYPE } from "./types";

const LOADOUT_DEMO_DIR = path.resolve(__dirname, "../../examples/loadout-demo");

function loadDemoTemplate(): ResolvedTemplate {
  return TemplateLoader.load(LOADOUT_DEMO_DIR);
}

function loadDemoLoadout(name: string): ResolvedLoadout {
  const template = loadDemoTemplate();
  const loadout = template.loadouts.get(name);
  if (!loadout) throw new Error(`loadout not found: ${name}`);
  return loadout;
}

describe("canonicalize", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ b: { z: 1, a: 2 }, a: 1 })).toBe(
      '{"a":1,"b":{"a":2,"z":1}}'
    );
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("omits undefined-valued properties", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("normalizes CRLF to LF in strings", () => {
    expect(canonicalize("line1\r\nline2")).toBe('"line1\\nline2"');
    expect(canonicalize({ p: "a\r\nb" })).toBe('{"p":"a\\nb"}');
  });

  it("normalizes Unicode to NFC so NFD and NFC equivalents canonicalize equally", () => {
    // "café" in NFD: c, a, f, e + combining acute → 5 code points
    // "café" in NFC: c, a, f, é → 4 code points
    const nfd = "café";
    const nfc = "café";
    expect(nfd).not.toBe(nfc); // different byte sequences pre-normalization
    expect(canonicalize(nfd)).toBe(canonicalize(nfc));
    expect(canonicalize({ name: nfd })).toBe(canonicalize({ name: nfc }));
  });

  it("preserves trailing whitespace (markdown line breaks use two trailing spaces)", () => {
    // Markdown: a line ending in two spaces produces a <br>. Trimming would corrupt this.
    expect(canonicalize("line  \nnext")).toBe('"line  \\nnext"');
    expect(canonicalize({ p: "trailing   " })).toBe('{"p":"trailing   "}');
  });

  it("emits null distinctly from omitted-undefined", () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
    expect(canonicalize({ a: undefined })).toBe("{}");
  });

  it("treats Maps as plain objects with sorted keys", () => {
    const m = new Map<string, number>();
    m.set("b", 2);
    m.set("a", 1);
    expect(canonicalize(m)).toBe('{"a":1,"b":2}');
  });

  it("produces the same output regardless of property insertion order", () => {
    const a = { x: 1, y: { p: 1, q: 2 } };
    const b = { y: { q: 2, p: 1 }, x: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

describe("hash", () => {
  it("returns sha256:<hex> form", () => {
    const h = hash("hello");
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hash("hello")).toBe(hash("hello"));
  });

  it("differs for different inputs", () => {
    expect(hash("hello")).not.toBe(hash("world"));
  });
});

describe("bundleLoadout", () => {
  it("produces a deterministic id for the same (name, version, resolved)", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const a = bundleLoadout(resolved, { version: "1.0.0", timestamp: "2026-01-01T00:00:00Z" });
    const b = bundleLoadout(resolved, { version: "1.0.0", timestamp: "2026-09-09T00:00:00Z" });
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("uses resolved.name when name option is omitted", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    expect(bundle.name).toBe(resolved.name);
  });

  it("respects an explicit name option", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0", name: "Renamed" });
    expect(bundle.name).toBe("Renamed");
  });

  it("sets the resource type to x-openteams/loadout", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    expect(bundle.type).toBe(LOADOUT_RESOURCE_TYPE);
  });

  it("excludes descriptive metadata from the hash", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bare = bundleLoadout(resolved, { version: "1.0.0" });
    const decorated = bundleLoadout(resolved, {
      version: "1.0.0",
      description: "human-friendly summary",
      tags: ["review", "static-analysis"],
      publisher: { id: "did:example:alex", signature: "sig" },
    });
    expect(bare.id).toBe(decorated.id);
  });

  it("excludes timestamps and ownership from the hash", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const a = bundleLoadout(resolved, {
      version: "1.0.0",
      timestamp: "2026-01-01T00:00:00Z",
      ownerId: "agent_a",
    });
    const b = bundleLoadout(resolved, {
      version: "1.0.0",
      timestamp: "2026-09-09T12:34:56Z",
      ownerId: "agent_b",
    });
    expect(a.id).toBe(b.id);
  });

  it("does not change the hash when only the version label changes", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const a = bundleLoadout(resolved, { version: "1.0.0" });
    const b = bundleLoadout(resolved, { version: "1.0.1" });
    expect(a.id).toBe(b.id);
  });

  it("changes the hash when the resolved name changes", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const a = bundleLoadout(resolved, { version: "1.0.0" });
    const b = bundleLoadout(resolved, { version: "1.0.0", name: "different" });
    expect(a.id).not.toBe(b.id);
  });

  it("changes the hash when the resolved content changes", () => {
    const reviewer = loadDemoLoadout("code-reviewer");
    const implementer = loadDemoLoadout("implementer");
    const a = bundleLoadout(reviewer, { version: "1.0.0" });
    const b = bundleLoadout(implementer, { version: "1.0.0" });
    expect(a.id).not.toBe(b.id);
  });

  it("populates timestamps and origin_hub_id correctly", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const ts = "2026-05-08T12:00:00Z";
    const bundle = bundleLoadout(resolved, { version: "1.0.0", timestamp: ts });
    expect(bundle.created_at).toBe(ts);
    expect(bundle.updated_at).toBe(ts);
    expect(bundle.origin_hub_id).toBeNull();
    expect(bundle.status).toBe("active");
  });
});

describe("hydrateLoadout", () => {
  it("round-trips: bundleLoadout → hydrateLoadout returns equal ResolvedLoadout", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    const hydrated = hydrateLoadout(bundle);
    expect(hydrated).toEqual(resolved);
  });

  it("throws when the resource id has been tampered with", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    const tampered = { ...bundle, id: "sha256:" + "0".repeat(64) };
    expect(() => hydrateLoadout(tampered)).toThrow(/hash mismatch/);
  });

  it("throws when the metadata.resolved has been tampered with", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    const tampered = {
      ...bundle,
      metadata: {
        ...bundle.metadata,
        resolved: {
          ...bundle.metadata.resolved,
          capabilities: [...bundle.metadata.resolved.capabilities, "extra.cap"],
        },
      },
    };
    expect(() => hydrateLoadout(tampered)).toThrow(/hash mismatch/);
  });
});

describe("verifyHash", () => {
  it("returns true for an intact bundle", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    expect(verifyHash(bundle)).toBe(true);
  });

  it("returns false when the id does not match the metadata", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    const tampered = { ...bundle, id: "sha256:" + "0".repeat(64) };
    expect(verifyHash(tampered)).toBe(false);
  });

  it("survives mutation of fields that don't participate in the hash", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    const mutated: typeof bundle = {
      ...bundle,
      created_at: "2099-01-01T00:00:00Z",
      updated_at: "2099-01-01T00:00:00Z",
      owner_id: "different-owner",
      status: "deprecated",
      metadata: {
        ...bundle.metadata,
        description: "post-hoc description",
        tags: ["new-tag"],
        publisher: { id: "did:example:other" },
      },
    };
    expect(verifyHash(mutated)).toBe(true);
  });
});

describe("computeLoadoutId", () => {
  it("matches the id produced by bundleLoadout", () => {
    const resolved = loadDemoLoadout("code-reviewer");
    const bundle = bundleLoadout(resolved, { version: "1.0.0" });
    const expected = computeLoadoutId(bundle.name, bundle.metadata);
    expect(expected).toBe(bundle.id);
  });
});

describe("bundleTeam", () => {
  it("produces a deterministic id for the same template", () => {
    const a = bundleTeam(loadDemoTemplate(), { version: "1.0.0", timestamp: "2026-01-01T00:00:00Z" });
    const b = bundleTeam(loadDemoTemplate(), { version: "1.0.0", timestamp: "2026-09-09T00:00:00Z" });
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("sets the resource type and basic envelope fields", () => {
    const bundle = bundleTeam(loadDemoTemplate(), {
      version: "1.0.0",
      timestamp: "2026-05-08T12:00:00Z",
    });
    expect(bundle.type).toBe(TEAM_RESOURCE_TYPE);
    expect(bundle.name).toBe("loadout-demo");
    expect(bundle.created_at).toBe("2026-05-08T12:00:00Z");
    expect(bundle.updated_at).toBe("2026-05-08T12:00:00Z");
    expect(bundle.origin_hub_id).toBeNull();
    expect(bundle.status).toBe("active");
  });

  it("uses manifest.name when name option is omitted", () => {
    const template = loadDemoTemplate();
    const bundle = bundleTeam(template, { version: "1.0.0" });
    expect(bundle.name).toBe(template.manifest.name);
  });

  it("respects an explicit name override", () => {
    const bundle = bundleTeam(loadDemoTemplate(), { version: "1.0.0", name: "renamed" });
    expect(bundle.name).toBe("renamed");
  });

  it("does not change the hash when only the version label changes", () => {
    const a = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    const b = bundleTeam(loadDemoTemplate(), { version: "2.5.0" });
    expect(a.id).toBe(b.id);
  });

  it("excludes descriptive metadata from the hash", () => {
    const bare = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    const decorated = bundleTeam(loadDemoTemplate(), {
      version: "1.0.0",
      description: "human-friendly summary",
      tags: ["demo"],
      publisher: { id: "did:example:alex" },
    });
    expect(bare.id).toBe(decorated.id);
  });

  it("excludes timestamps and ownership from the hash", () => {
    const a = bundleTeam(loadDemoTemplate(), {
      version: "1.0.0",
      timestamp: "2026-01-01T00:00:00Z",
      ownerId: "agent_a",
    });
    const b = bundleTeam(loadDemoTemplate(), {
      version: "1.0.0",
      timestamp: "2099-09-09T00:00:00Z",
      ownerId: "agent_b",
    });
    expect(a.id).toBe(b.id);
  });

  it("changes the hash when the team name changes", () => {
    const a = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    const b = bundleTeam(loadDemoTemplate(), { version: "1.0.0", name: "different" });
    expect(a.id).not.toBe(b.id);
  });

  it("populates loadouts with deterministic embedded ids", () => {
    const bundle = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    expect(Object.keys(bundle.metadata.loadouts).length).toBeGreaterThan(0);
    for (const [name, embedded] of Object.entries(bundle.metadata.loadouts)) {
      expect(embedded.id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(embedded.resolved.name).toBe(name);
    }
  });
});

describe("embedded loadout id matches standalone loadout id", () => {
  it("for every loadout in the demo template", () => {
    const template = loadDemoTemplate();
    const teamBundle = bundleTeam(template, { version: "1.0.0" });

    expect(Object.keys(teamBundle.metadata.loadouts).length).toBeGreaterThan(0);

    for (const [name, embedded] of Object.entries(teamBundle.metadata.loadouts)) {
      const resolved = template.loadouts.get(name);
      if (!resolved) throw new Error(`loadout not found: ${name}`);
      const standalone = bundleLoadout(resolved, { version: "1.0.0", name });
      expect(embedded.id).toBe(standalone.id);
    }
  });

  it("is unaffected by the descriptive metadata of either bundle", () => {
    const template = loadDemoTemplate();
    const teamBundle = bundleTeam(template, {
      version: "9.9.9",
      description: "team-side description",
      tags: ["x"],
    });

    for (const [name, embedded] of Object.entries(teamBundle.metadata.loadouts)) {
      const resolved = template.loadouts.get(name);
      if (!resolved) throw new Error(`loadout not found: ${name}`);
      const standalone = bundleLoadout(resolved, {
        version: "0.0.1",
        name,
        description: "loadout-side description",
        tags: ["y"],
      });
      expect(embedded.id).toBe(standalone.id);
    }
  });
});

describe("hydrateBundle", () => {
  it("round-trips: bundleTeam → hydrateBundle reproduces the resolved template", () => {
    const original = loadDemoTemplate();
    const bundle = bundleTeam(original, { version: "1.0.0" });
    const hydrated = hydrateBundle(bundle);

    // sourcePath is intentionally not preserved
    expect(hydrated.manifest).toEqual(original.manifest);
    expect(Array.from(hydrated.roles.entries())).toEqual(Array.from(original.roles.entries()));
    expect(Array.from(hydrated.prompts.entries())).toEqual(Array.from(original.prompts.entries()));
    expect(Array.from(hydrated.mcpServers.entries())).toEqual(Array.from(original.mcpServers.entries()));
    expect(Array.from(hydrated.loadouts.entries())).toEqual(Array.from(original.loadouts.entries()));
    expect(Array.from(hydrated.mcpProviders.entries())).toEqual(Array.from(original.mcpProviders.entries()));
  });

  it("throws when the team resource id has been tampered with", () => {
    const bundle = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    const tampered = { ...bundle, id: "sha256:" + "0".repeat(64) };
    expect(() => hydrateBundle(tampered)).toThrow(/Team hash mismatch/);
  });

  it("throws when an embedded loadout has been tampered with", () => {
    const template = loadDemoTemplate();
    const bundle = bundleTeam(template, { version: "1.0.0" });
    const [firstName] = Object.keys(bundle.metadata.loadouts);
    if (!firstName) throw new Error("expected at least one loadout");
    const original = bundle.metadata.loadouts[firstName]!;

    const tampered: typeof bundle = {
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

    // Recompute the team id so the team-level check passes —
    // we want the embedded-loadout check to be the one that fires.
    tampered.id = computeTeamId(tampered.name, tampered.metadata);
    expect(() => hydrateBundle(tampered)).toThrow(/Embedded loadout .+ hash mismatch/);
  });

  it("rebuilds mcpProviders from manifest.mcp_providers", () => {
    const template = loadDemoTemplate();
    const bundle = bundleTeam(template, { version: "1.0.0" });
    const hydrated = hydrateBundle(bundle);
    expect(Array.from(hydrated.mcpProviders.entries())).toEqual(
      Array.from(template.mcpProviders.entries())
    );
  });
});

describe("hydrated template feeds existing generators", () => {
  it("generateSkillMd produces identical output for original and hydrated", async () => {
    const { generateSkillMd } = await import("../generators/skill-generator");
    const original = loadDemoTemplate();
    const bundle = bundleTeam(original, { version: "1.0.0" });
    const hydrated = hydrateBundle(bundle);

    const fromOriginal = generateSkillMd(original);
    const fromHydrated = generateSkillMd(hydrated);
    expect(fromHydrated).toBe(fromOriginal);
  });
});

describe("verifyTeamHash", () => {
  it("returns true for an intact bundle", () => {
    const bundle = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    expect(verifyTeamHash(bundle)).toBe(true);
  });

  it("returns false when the team id does not match the metadata", () => {
    const bundle = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    const tampered = { ...bundle, id: "sha256:" + "0".repeat(64) };
    expect(verifyTeamHash(tampered)).toBe(false);
  });

  it("survives mutation of fields that don't participate in the hash", () => {
    const bundle = bundleTeam(loadDemoTemplate(), { version: "1.0.0" });
    const mutated: typeof bundle = {
      ...bundle,
      created_at: "2099-01-01T00:00:00Z",
      updated_at: "2099-01-01T00:00:00Z",
      owner_id: "different-owner",
      metadata: {
        ...bundle.metadata,
        version: "9.9.9",
        description: "post-hoc",
        tags: ["new"],
        publisher: { id: "did:example:other" },
      },
    };
    expect(verifyTeamHash(mutated)).toBe(true);
  });
});
