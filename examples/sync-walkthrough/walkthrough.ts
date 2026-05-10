/**
 * Worked example: end-to-end sync walkthrough using the loadout-demo template.
 *
 * Run from the repo root:
 *   npx tsx examples/sync-walkthrough/walkthrough.ts
 *
 * Demonstrates:
 *   1. Loading a template from disk
 *   2. Bundling the team and each loadout
 *   3. JSON serialization (the wire transfer)
 *   4. Hashing invariants (embedded == standalone, content-derived ids)
 *   5. Hydrating on the receiver side
 *   6. Validating the received bundle
 *   7. Spawn dispatch encoding/decoding
 *
 * In a real consumer project, replace the relative imports below with:
 *   import { ... } from "openteams";
 */

import * as path from "node:path";

import { TemplateLoader } from "../../src/template/loader";
import {
  bundleLoadout,
  bundleTeam,
  canonicalize,
  hydrateBundle,
  hydrateLoadout,
} from "../../src/sync/bundle";
import {
  decodeSpawnTaskMeta,
  encodeSpawnTaskMeta,
} from "../../src/sync/spawn";
import {
  loadoutRef,
  teamRef,
} from "../../src/sync/uri";
import {
  validateLoadoutBundle,
  validateTeamBundle,
} from "../../src/sync/validate";
import type {
  LoadoutResource,
  SpawnRequest,
  TeamResource,
} from "../../src/sync/types";

const LOADOUT_DEMO_DIR = path.resolve(__dirname, "../loadout-demo");

function header(s: string): void {
  console.log(`\n--- ${s} ---`);
}

function shortHash(id: string): string {
  return id.startsWith("sha256:") ? id.slice(0, 14) + "…" : id;
}

// ─────────────────────────────────────────────────────────────
// 1. Publisher: load template and bundle
// ─────────────────────────────────────────────────────────────

header("1. Publisher loads and bundles");

const template = TemplateLoader.load(LOADOUT_DEMO_DIR);
console.log(`Loaded template:    ${template.manifest.name}`);
console.log(`Roles:              ${template.manifest.roles.join(", ")}`);
console.log(`Loadouts:           ${Array.from(template.loadouts.keys()).join(", ")}`);
console.log(`MCP providers:      ${Array.from(template.mcpProviders.keys()).join(", ") || "(none)"}`);

const teamBundle = bundleTeam(template, {
  version: "1.0.0",
  description: "Walkthrough team bundle",
});
console.log(`\nTeam bundle id:     ${shortHash(teamBundle.id)}`);

const standaloneLoadouts: Record<string, LoadoutResource> = {};
for (const [name, resolved] of template.loadouts) {
  const lo = bundleLoadout(resolved, { version: "1.0.0", name });
  standaloneLoadouts[name] = lo;
  console.log(`Loadout '${name}':   ${shortHash(lo.id)}`);
}

// ─────────────────────────────────────────────────────────────
// 2. Hash invariant: embedded == standalone
// ─────────────────────────────────────────────────────────────

header("2. Embedded loadout ids match standalone ids");

for (const [name, embedded] of Object.entries(teamBundle.metadata.loadouts)) {
  const standalone = standaloneLoadouts[name]!;
  const match = embedded.id === standalone.id ? "✓" : "✗";
  console.log(`${match} ${name.padEnd(20)} embedded=${shortHash(embedded.id)} standalone=${shortHash(standalone.id)}`);
}

// ─────────────────────────────────────────────────────────────
// 3. Wire transfer: JSON.stringify + parse
// ─────────────────────────────────────────────────────────────

header("3. Wire transfer (JSON serialization)");

const teamWire = JSON.stringify(teamBundle);
console.log(`Team bundle JSON:   ${teamWire.length} bytes`);

const receivedTeam: TeamResource = JSON.parse(teamWire);
console.log(`Received id:        ${shortHash(receivedTeam.id)}  (matches: ${receivedTeam.id === teamBundle.id})`);

// ─────────────────────────────────────────────────────────────
// 4. Consumer: validate, then hydrate
// ─────────────────────────────────────────────────────────────

header("4. Consumer validates and hydrates");

const teamValidation = validateTeamBundle(receivedTeam);
console.log(`Team validation:    valid=${teamValidation.valid}, violations=${teamValidation.violations.length}`);
for (const v of teamValidation.violations) {
  console.log(`  ${v.severity.toUpperCase().padEnd(7)} ${v.message}`);
}

const hydrated = hydrateBundle(receivedTeam);
console.log(`Hydrated template:  ${hydrated.manifest.name}`);
console.log(`  roles:            ${Array.from(hydrated.roles.keys()).join(", ")}`);
console.log(`  loadouts:         ${Array.from(hydrated.loadouts.keys()).join(", ")}`);

// Equivalent for a leaf agent that only needs its own loadout:
const reviewerWire = JSON.stringify(standaloneLoadouts["code-reviewer"]);
const receivedReviewer: LoadoutResource = JSON.parse(reviewerWire);
const reviewerHydrated = hydrateLoadout(receivedReviewer);
console.log(`\nLeaf agent hydrate: '${reviewerHydrated.name}' (${reviewerHydrated.capabilities.length} capabilities)`);

// ─────────────────────────────────────────────────────────────
// 5. Spawn dispatch encode → wire → decode
// ─────────────────────────────────────────────────────────────

header("5. Spawn dispatch round-trip");

const reviewerStandalone = standaloneLoadouts["code-reviewer"]!;
const spawnReq: SpawnRequest = {
  loadout: loadoutRef(reviewerStandalone.id),
  team: teamRef(teamBundle.id),
  role: "reviewer",
  label: "reviewer-1",
  target: { runtime: "claude-code" },
  parent: "orchestrator-1",
};
console.log(`Spawn request:      role=${spawnReq.role}, label=${spawnReq.label}`);
console.log(`  loadout ref:      ${spawnReq.loadout.slice(0, 40)}…`);
console.log(`  team ref:         ${spawnReq.team!.slice(0, 40)}…`);

const taskWire = JSON.stringify({
  id: "spawn-task-1",
  status: "open",
  meta: encodeSpawnTaskMeta(spawnReq),
});
console.log(`Task on the wire:   ${taskWire.length} bytes`);

const taskReceived = JSON.parse(taskWire);
const decoded = decodeSpawnTaskMeta(taskReceived.meta);
// Use canonical form so insertion order doesn't fool the string compare
const matches = canonicalize(decoded) === canonicalize(spawnReq);
console.log(`Decoded matches:    ${matches}`);

// ─────────────────────────────────────────────────────────────
// 6. Tampering detection
// ─────────────────────────────────────────────────────────────

header("6. Tampering detection");

const tamperedJson = JSON.parse(JSON.stringify(reviewerStandalone)) as LoadoutResource;
tamperedJson.metadata.resolved.capabilities.push("evil.escalation");

const tamperedValidation = validateLoadoutBundle(tamperedJson);
const errorMsg = tamperedValidation.violations.find((v) => v.severity === "error")?.message;
console.log(`Tampered loadout:   valid=${tamperedValidation.valid}`);
console.log(`  error:            ${errorMsg}`);

try {
  hydrateLoadout(tamperedJson);
  console.log("  hydrate:          (unexpected: did not throw)");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  hydrate threw:    ${msg.slice(0, 80)}…`);
}

console.log();
console.log("Walkthrough complete.");
