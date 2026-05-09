// ─────────────────────────────────────────────────────────────
// Bundle validation
// ─────────────────────────────────────────────────────────────
// Non-throwing validators that return ValidationResult. Use these
// when you want a violation list (warnings + errors) instead of an
// exception. `hydrateLoadout` / `hydrateBundle` still throw on hash
// mismatch — those are correctness issues, not warnings.

import { findMissingMcpReferences } from "../generators/loadout-generator";
import type { ValidationResult, Violation } from "../runtime/types";
import type { McpServerEntry, ResolvedTemplate } from "../template/types";
import { computeLoadoutId, verifyHash, verifyTeamHash } from "./bundle";
import type { LoadoutResource, TeamResource } from "./types";

export interface ValidateBundleOptions {
  /**
   * Set of MCP server names known to be available in the consumer's
   * environment. Used to flag scope references that don't resolve.
   */
  installedMcpServers?: Iterable<string>;
}

/**
 * Validate a loadout resource. Reports:
 *   - error: hash mismatch (resource has been tampered with)
 *   - warning: scope references an MCP server that's neither installed
 *     locally nor in the loadout's own install specs
 *
 * Returns `valid: true` when there are no error-severity violations.
 */
export function validateLoadoutBundle(
  resource: LoadoutResource,
  opts: ValidateBundleOptions = {}
): ValidationResult {
  const violations: Violation[] = [];

  if (!verifyHash(resource)) {
    violations.push({
      severity: "error",
      message: `Loadout hash mismatch: id ${resource.id} does not match content`,
    });
  }

  const resolved = resource.metadata.resolved;
  const available = new Set<string>(opts.installedMcpServers ?? []);
  for (const entry of resolved.mcpServers) {
    if (isInstallEntry(entry)) available.add(entry.name);
  }

  for (const scope of resolved.mcpScope) {
    if (!available.has(scope.server)) {
      violations.push({
        severity: "warning",
        message: `MCP scope references unknown server: ${scope.server}`,
      });
    }
  }

  return {
    valid: violations.every((v) => v.severity !== "error"),
    violations,
  };
}

/**
 * Validate a team resource. Reports:
 *   - error: team hash mismatch
 *   - error: any embedded loadout hash mismatch
 *   - warning: any role's loadout scope references an MCP server that
 *     isn't in the team's manifest providers or the consumer's installed
 *     set or any loadout's own install specs
 *
 * Returns `valid: true` when there are no error-severity violations.
 */
export function validateTeamBundle(
  resource: TeamResource,
  opts: ValidateBundleOptions = {}
): ValidationResult {
  const violations: Violation[] = [];

  const teamHashOk = verifyTeamHash(resource);
  if (!teamHashOk) {
    violations.push({
      severity: "error",
      message: `Team hash mismatch: id ${resource.id} does not match content`,
    });
  }

  let allLoadoutsOk = true;
  for (const [name, embedded] of Object.entries(resource.metadata.loadouts)) {
    const expected = computeLoadoutId(name, {
      bundleVersion: 1,
      resolved: embedded.resolved,
    });
    if (expected !== embedded.id) {
      violations.push({
        severity: "error",
        message: `Embedded loadout '${name}' hash mismatch`,
      });
      allLoadoutsOk = false;
    }
  }

  // Defer non-fatal checks until hashes are sound — running them on
  // tampered content would produce noise.
  if (teamHashOk && allLoadoutsOk) {
    const template = reconstructTemplate(resource);
    const missing = findMissingMcpReferences(template, opts.installedMcpServers);
    for (const m of missing) {
      violations.push({
        severity: "warning",
        message: `Loadout '${m.loadout}' references unknown MCP server: ${m.server}`,
      });
    }
  }

  return {
    valid: violations.every((v) => v.severity !== "error"),
    violations,
  };
}

function isInstallEntry(
  entry: { name: string } | { ref: string }
): entry is McpServerEntry {
  return "name" in entry;
}

/**
 * Reconstruct just enough of a `ResolvedTemplate` to satisfy
 * `findMissingMcpReferences`. Cheaper than a full `hydrateBundle`
 * call — and avoids the throwing behavior since the caller has
 * already vetted hashes.
 */
function reconstructTemplate(resource: TeamResource): ResolvedTemplate {
  const m = resource.metadata;
  return {
    manifest: m.manifest,
    roles: new Map(Object.entries(m.roles)),
    prompts: new Map(Object.entries(m.prompts)),
    mcpServers: new Map(Object.entries(m.mcpServers)),
    loadouts: new Map(
      Object.entries(m.loadouts).map(
        ([name, embedded]) => [name, embedded.resolved] as const
      )
    ),
    mcpProviders: new Map(Object.entries(m.manifest.mcp_providers ?? {})),
    sourcePath: "",
  };
}
