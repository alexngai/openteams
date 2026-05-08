// ─────────────────────────────────────────────────────────────
// Bundle Helpers — canonicalization, hashing, build, hydrate
// ─────────────────────────────────────────────────────────────
// Pure functions. No I/O, no transport. Same input on different
// machines must produce byte-identical bundles and identical hashes.
//
// See docs/team-map-sync-design.md for the design.

import { createHash } from "node:crypto";
import type { ResolvedLoadout } from "../template/types";
import {
  type BundleLoadoutOptions,
  type LoadoutResource,
  type LoadoutResourceMetadata,
  LOADOUT_RESOURCE_TYPE,
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
 *   - String line endings normalized: `\r\n` → `\n`.
 *   - All other content preserved verbatim (no trimming).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.replace(/\r\n/g, "\n");
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
 * fields only — descriptive metadata, timestamps, owner, and publisher
 * are excluded.
 */
export function computeLoadoutId(
  name: string,
  metadata: Pick<LoadoutResourceMetadata, "bundleVersion" | "version" | "resolved">
): string {
  const hashInput = {
    bundleVersion: metadata.bundleVersion,
    type: LOADOUT_RESOURCE_TYPE,
    name,
    version: metadata.version,
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
