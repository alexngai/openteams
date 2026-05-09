// ─────────────────────────────────────────────────────────────
// Bundle Helpers — canonicalization, hashing, build, hydrate
// ─────────────────────────────────────────────────────────────
// Pure functions. No I/O, no transport. Same input on different
// machines must produce byte-identical bundles and identical hashes.
//
// See docs/team-map-sync-design.md for the design.

import { createHash } from "node:crypto";
import type {
  McpProviderSpec,
  ResolvedLoadout,
  ResolvedTemplate,
} from "../template/types";
import {
  type BundleLoadoutOptions,
  type BundleTeamOptions,
  type EmbeddedLoadout,
  type LoadoutResource,
  type LoadoutResourceMetadata,
  type TeamResource,
  type TeamResourceMetadata,
  LOADOUT_RESOURCE_TYPE,
  TEAM_RESOURCE_TYPE,
} from "./types";

// ─────────────────────────────────────────────────────────────
// Canonicalization
// ─────────────────────────────────────────────────────────────

/**
 * Produce a deterministic JSON string for a value.
 *
 *   - Object keys sorted recursively.
 *   - Map keys sorted; Maps treated as plain objects.
 *   - Array order preserved (order is meaningful).
 *   - Properties whose value is `undefined` are omitted.
 *   - String values normalized to **NFC Unicode** so that the same
 *     accented character produced on macOS (often NFD) and Linux
 *     (NFC) yields identical bytes — load-bearing for cross-machine
 *     hash determinism.
 *   - String line endings normalized: `\r\n` → `\n`.
 *   - Trailing whitespace is **not** trimmed. Markdown line breaks
 *     are encoded as two trailing spaces; trimming would corrupt
 *     prompt bodies.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.normalize("NFC").replace(/\r\n/g, "\n");
  }

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    const keys = Array.from(value.keys()).map(String).sort();
    for (const k of keys) {
      const v = canonicalizeValue(value.get(k));
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  // Plain object: sort keys, omit undefined values
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value as object).sort();
  for (const k of keys) {
    const v = canonicalizeValue((value as Record<string, unknown>)[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Hashing
// ─────────────────────────────────────────────────────────────

/** Compute a sha256 hex digest of a string and return it as `sha256:<hex>`. */
export function hash(input: string): string {
  return "sha256:" + createHash("sha256").update(input, "utf8").digest("hex");
}

// ─────────────────────────────────────────────────────────────
// Loadout bundle build / hydrate
// ─────────────────────────────────────────────────────────────

/**
 * Compute the content hash for a loadout resource. Identity-bearing
 * fields only — version (an author-controlled semver label),
 * descriptive metadata, timestamps, owner, and publisher are excluded.
 *
 * Two byte-identical loadouts published under different version labels
 * yield the same id; the alias (e.g. `code-reviewer@2.0.0`) is a
 * separate pointer to the resource.
 */
export function computeLoadoutId(
  name: string,
  metadata: Pick<LoadoutResourceMetadata, "bundleVersion" | "resolved">
): string {
  const hashInput = {
    bundleVersion: metadata.bundleVersion,
    type: LOADOUT_RESOURCE_TYPE,
    name,
    resolved: metadata.resolved,
  };
  return hash(canonicalize(hashInput));
}

/**
 * Bundle a `ResolvedLoadout` into a content-addressed `x-openteams/loadout`
 * resource. The returned `id` is `sha256:<hex>` and is deterministic for
 * the same `(name, version, resolved)` triple regardless of host.
 */
export function bundleLoadout(
  resolved: ResolvedLoadout,
  opts: BundleLoadoutOptions
): LoadoutResource {
  const name = opts.name ?? resolved.name;

  const metadata: LoadoutResourceMetadata = {
    bundleVersion: 1,
    version: opts.version,
    resolved,
  };
  if (opts.publisher !== undefined) metadata.publisher = opts.publisher;
  if (opts.description !== undefined) metadata.description = opts.description;
  if (opts.tags !== undefined) metadata.tags = opts.tags;

  const id = computeLoadoutId(name, metadata);
  const timestamp = opts.timestamp ?? new Date().toISOString();

  return {
    id,
    type: LOADOUT_RESOURCE_TYPE,
    name,
    status: "active",
    owner_id: opts.ownerId ?? "",
    origin_hub_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    metadata,
  };
}

/**
 * Recompute the hash and compare to the resource's id.
 * Returns true if they match (resource is intact), false otherwise.
 */
export function verifyHash(resource: LoadoutResource): boolean {
  const expected = computeLoadoutId(resource.name, resource.metadata);
  return expected === resource.id;
}

/**
 * Inverse of `bundleLoadout`. Verifies the hash before returning the
 * resolved loadout — throws if the resource has been tampered with.
 */
export function hydrateLoadout(resource: LoadoutResource): ResolvedLoadout {
  if (!verifyHash(resource)) {
    const expected = computeLoadoutId(resource.name, resource.metadata);
    throw new Error(
      `Loadout hash mismatch: expected ${expected}, got ${resource.id}`
    );
  }
  return resource.metadata.resolved;
}

// ─────────────────────────────────────────────────────────────
// Team bundle build / hydrate
// ─────────────────────────────────────────────────────────────

/**
 * Compute the content hash for a team resource. Includes the manifest,
 * roles, prompts, legacy mcpServers, and embedded loadout id refs. The
 * loadouts' full resolved content is captured indirectly through their
 * standalone hashes (and through `roles` since each ResolvedRole carries
 * its loadout content). Version, descriptive metadata, timestamps, and
 * ownership are excluded.
 */
export function computeTeamId(
  name: string,
  metadata: Pick<
    TeamResourceMetadata,
    "bundleVersion" | "manifest" | "roles" | "loadouts" | "prompts" | "mcpServers"
  >
): string {
  const loadoutRefs: Record<string, string> = {};
  for (const [loadoutName, embedded] of Object.entries(metadata.loadouts)) {
    loadoutRefs[loadoutName] = embedded.id;
  }

  const hashInput = {
    bundleVersion: metadata.bundleVersion,
    type: TEAM_RESOURCE_TYPE,
    name,
    manifest: metadata.manifest,
    roles: metadata.roles,
    loadoutRefs,
    prompts: metadata.prompts,
    mcpServers: metadata.mcpServers,
  };
  return hash(canonicalize(hashInput));
}

/**
 * Bundle a `ResolvedTemplate` into a content-addressed `x-openteams/team`
 * resource. Embedded loadouts are bundled standalone first; their ids
 * are equal to what `bundleLoadout(resolved).id` would produce, so the
 * same loadout addressed two ways resolves to the same hash.
 *
 * `mcpProviders` is not stored separately in the bundle — it is
 * reconstructed from `manifest.mcp_providers` at hydrate time.
 */
export function bundleTeam(
  template: ResolvedTemplate,
  opts: BundleTeamOptions
): TeamResource {
  const name = opts.name ?? template.manifest.name;

  const loadouts: Record<string, EmbeddedLoadout> = {};
  for (const [loadoutName, resolved] of template.loadouts) {
    const id = computeLoadoutId(loadoutName, { bundleVersion: 1, resolved });
    loadouts[loadoutName] = { id, resolved };
  }

  const metadata: TeamResourceMetadata = {
    bundleVersion: 1,
    version: opts.version,
    manifest: template.manifest,
    roles: Object.fromEntries(template.roles),
    loadouts,
    prompts: Object.fromEntries(template.prompts),
    mcpServers: Object.fromEntries(template.mcpServers),
  };
  if (opts.publisher !== undefined) metadata.publisher = opts.publisher;
  if (opts.description !== undefined) metadata.description = opts.description;
  if (opts.tags !== undefined) metadata.tags = opts.tags;

  const id = computeTeamId(name, metadata);
  const timestamp = opts.timestamp ?? new Date().toISOString();

  return {
    id,
    type: TEAM_RESOURCE_TYPE,
    name,
    status: "active",
    owner_id: opts.ownerId ?? "",
    origin_hub_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    metadata,
  };
}

/** Recompute and compare the team resource hash. */
export function verifyTeamHash(resource: TeamResource): boolean {
  return computeTeamId(resource.name, resource.metadata) === resource.id;
}

/**
 * Inverse of `bundleTeam`. Verifies the team hash and every embedded
 * loadout hash before reconstructing the `ResolvedTemplate`. Throws on
 * any mismatch.
 *
 * The reconstructed `sourcePath` is empty — it has no meaning across
 * machines. Consumers that need a path can set it after hydrate.
 */
export function hydrateBundle(resource: TeamResource): ResolvedTemplate {
  if (!verifyTeamHash(resource)) {
    const expected = computeTeamId(resource.name, resource.metadata);
    throw new Error(
      `Team hash mismatch: expected ${expected}, got ${resource.id}`
    );
  }

  for (const [loadoutName, embedded] of Object.entries(resource.metadata.loadouts)) {
    const expected = computeLoadoutId(loadoutName, {
      bundleVersion: 1,
      resolved: embedded.resolved,
    });
    if (expected !== embedded.id) {
      throw new Error(
        `Embedded loadout '${loadoutName}' hash mismatch: expected ${expected}, got ${embedded.id}`
      );
    }
  }

  const mcpProviders = new Map<string, McpProviderSpec>(
    Object.entries(resource.metadata.manifest.mcp_providers ?? {})
  );

  return {
    manifest: resource.metadata.manifest,
    roles: new Map(Object.entries(resource.metadata.roles)),
    prompts: new Map(Object.entries(resource.metadata.prompts)),
    mcpServers: new Map(Object.entries(resource.metadata.mcpServers)),
    loadouts: new Map(
      Object.entries(resource.metadata.loadouts).map(
        ([name, embedded]) => [name, embedded.resolved] as const
      )
    ),
    mcpProviders,
    sourcePath: "",
  };
}
