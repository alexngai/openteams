/**
 * Cross-process determinism: verify the canonical bundle hash is
 * identical across freshly-spawned Node processes. Catches things
 * an in-process e2e test can't:
 *
 *   - Map iteration order surviving fresh JS engine state
 *   - Locale-sensitive sort/string comparison (we use Array.sort
 *     with default UTF-16 ordering; this is deterministic across
 *     V8 instances, but worth pinning)
 *   - Future regressions where someone introduces a Date.now() or
 *     Math.random() into the canonicalize/hash path
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const REPO_ROOT = path.resolve(__dirname, "../..");
const LOADOUT_DEMO_DIR = path.resolve(REPO_ROOT, "examples/loadout-demo");

/** A tiny CLI script body that bundles loadout-demo and prints the hashes. */
const SCRIPT = `
import { TemplateLoader } from "${REPO_ROOT}/src/template/loader";
import { bundleLoadout, bundleTeam } from "${REPO_ROOT}/src/sync/bundle";

const t = TemplateLoader.load("${LOADOUT_DEMO_DIR}");

const team = bundleTeam(t, { version: "1.0.0" });
const loadouts: Record<string, string> = {};
for (const [name, lo] of t.loadouts) {
  loadouts[name] = bundleLoadout(lo, { version: "1.0.0", name }).id;
}

process.stdout.write(JSON.stringify({ team: team.id, loadouts }));
`;

interface BundleHashes {
  team: string;
  loadouts: Record<string, string>;
}

function runInFreshProcess(): BundleHashes {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openteams-xproc-"));
  const scriptPath = path.join(tmp, "bundle.ts");
  try {
    fs.writeFileSync(scriptPath, SCRIPT, "utf-8");
    const stdout = execSync(`npx tsx ${scriptPath}`, {
      encoding: "utf-8",
      timeout: 20000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("cross-process determinism", () => {
  it("produces identical hashes across two fresh Node processes", () => {
    const a = runInFreshProcess();
    const b = runInFreshProcess();

    expect(b.team).toBe(a.team);
    expect(Object.keys(b.loadouts).sort()).toEqual(Object.keys(a.loadouts).sort());
    for (const name of Object.keys(a.loadouts)) {
      expect(b.loadouts[name]).toBe(a.loadouts[name]);
    }
  }, 60000);

  it("matches in-process bundling results", async () => {
    const fresh = runInFreshProcess();

    // In-process — should match bit-for-bit
    const { TemplateLoader } = await import("../template/loader");
    const { bundleTeam, bundleLoadout } = await import("./bundle");
    const t = TemplateLoader.load(LOADOUT_DEMO_DIR);
    const teamHere = bundleTeam(t, { version: "1.0.0" }).id;

    expect(fresh.team).toBe(teamHere);

    for (const [name, lo] of t.loadouts) {
      const standalone = bundleLoadout(lo, { version: "1.0.0", name }).id;
      expect(fresh.loadouts[name]).toBe(standalone);
    }
  }, 60000);
});
