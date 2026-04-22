// ─────────────────────────────────────────────────────────────
// Loadout Generator
// ─────────────────────────────────────────────────────────────
// Takes a ResolvedLoadout and produces consumer-friendly artifacts.
// The actual write-to-disk step (.mcp.json, settings.json, skill
// bundle) is left to consuming systems — this layer just separates
// inline MCP entries from symbolic refs, exposes the permissions
// structure verbatim, and renders a YAML view for CLI display.

import yaml from "js-yaml";
import type {
  McpProviderSpec,
  McpServerEntry,
  McpServerRef,
  NormalizedMcpScope,
  PermissionsConfig,
  ResolvedLoadout,
  ResolvedTemplate,
  SkillsConfig,
} from "../template/types";

/**
 * Runtime-agnostic view of a loadout for consumer materialization.
 *
 * Three MCP-related fields cover the full surface:
 *   - `mcpServers` — loadout-authored install specs (inline name+command).
 *   - `mcpServerRefs` — symbolic refs; consumer resolves via its registry.
 *   - `mcpScope` — normalized scope declarations: which servers (and which
 *     tools within each server) the role may call. Drives AGENT.md tool
 *     allowlist / permissions at the consumer layer.
 *
 * Install and scope are separate concerns: a server may be in `mcpScope`
 * without ever appearing in `mcpServers` (already installed elsewhere).
 */
export interface LoadoutArtifacts {
  name: string;
  description: string;
  capabilities: string[];
  /** Loadout-authored install specs with inline command/args/env. */
  mcpServers: McpServerEntry[];
  /** Symbolic MCP server refs. Consumer must resolve each against its own registry. */
  mcpServerRefs: McpServerRef[];
  /** Normalized scope declarations — which servers and which tools are in scope. */
  mcpScope: NormalizedMcpScope[];
  permissions: PermissionsConfig;
  skills?: SkillsConfig;
  promptAddendum?: string;
}

/**
 * Convert a ResolvedLoadout into a LoadoutArtifacts bundle ready
 * for consumer materialization.
 */
export function generateLoadoutArtifacts(lo: ResolvedLoadout): LoadoutArtifacts {
  const mcpServers: McpServerEntry[] = [];
  const mcpServerRefs: McpServerRef[] = [];
  for (const entry of lo.mcpServers) {
    if ("ref" in entry) mcpServerRefs.push(entry);
    else mcpServers.push(entry);
  }
  return {
    name: lo.name,
    description: lo.description,
    capabilities: [...lo.capabilities],
    mcpServers,
    mcpServerRefs,
    mcpScope: lo.mcpScope.map((s) => ({
      server: s.server,
      tools: s.tools ? [...s.tools] : undefined,
      exclude: s.exclude ? [...s.exclude] : undefined,
    })),
    permissions: {
      allow: lo.permissions.allow ? [...lo.permissions.allow] : undefined,
      deny: lo.permissions.deny ? [...lo.permissions.deny] : undefined,
      ask: lo.permissions.ask ? [...lo.permissions.ask] : undefined,
    },
    skills: lo.skills ? { ...lo.skills } : undefined,
    promptAddendum: lo.promptAddendum,
  };
}

/**
 * Check loadout scope references against the declared provider set (and
 * optionally a consumer-supplied installed-set). Returns a list of server
 * names that are referenced in scope but absent from the provider map.
 *
 * Consumers (claude-code-swarm, OpenHive) typically call this at load
 * time and log warnings for missing servers — they know the actual base
 * set that openteams does not.
 *
 * @param template   ResolvedTemplate whose loadouts should be checked
 * @param installed  Optional superset of server names known to be installed
 *                   externally (plugin MCPs, user settings, hive DB). When
 *                   provided, a referenced server in this set is NOT flagged.
 */
export function findMissingMcpReferences(
  template: ResolvedTemplate,
  installed?: Iterable<string>
): { loadout: string; server: string }[] {
  const available = new Set<string>([
    ...template.mcpProviders.keys(),
    ...(installed ?? []),
  ]);
  const missing: { loadout: string; server: string }[] = [];
  for (const [name, lo] of template.loadouts) {
    for (const scope of lo.mcpScope) {
      if (!available.has(scope.server)) {
        missing.push({ loadout: name, server: scope.server });
      }
    }
    // Also flag loadout-authored install specs that claim a name not in
    // providers — not strictly missing (the loadout ships the install), but
    // useful for observability.
    for (const entry of lo.mcpServers) {
      if ("ref" in entry) continue;
      available.add(entry.name);
    }
  }
  return missing;
}

/**
 * Return the team-level MCP provider map as a plain object keyed by name.
 * Convenience for consumers that want to serialize to a Claude-compatible
 * `.mcp.json` (strip `ref`, `description`, `disabled` before writing).
 */
export function getMcpProviders(
  template: ResolvedTemplate
): Record<string, McpProviderSpec> {
  return Object.fromEntries(template.mcpProviders);
}

/**
 * Return the resolved loadout attached to a role, or null if none.
 * Handles slug bindings, inline definitions, and external-resolver
 * returns uniformly — all land on `role.loadout`.
 */
export function getEffectiveLoadout(
  template: ResolvedTemplate,
  roleName: string
): ResolvedLoadout | null {
  return template.roles.get(roleName)?.loadout ?? null;
}

/**
 * Render a resolved loadout as YAML for human-readable CLI display.
 * Omits empty sections. Not a round-trippable YAML definition — use
 * the raw file for that.
 */
export function renderLoadoutYaml(lo: ResolvedLoadout): string {
  const doc: Record<string, unknown> = {
    name: lo.name,
  };
  if (lo.extends) doc.extends = lo.extends;
  if (lo.description && lo.description !== `Loadout: ${lo.name}`) {
    doc.description = lo.description;
  }
  if (lo.skills && Object.values(lo.skills).some((v) => v !== undefined)) {
    doc.skills = lo.skills;
  }
  if (lo.capabilities.length > 0) doc.capabilities = lo.capabilities;
  if (lo.capabilityConfig && Object.keys(lo.capabilityConfig).length > 0) {
    doc.capability_config = lo.capabilityConfig;
  }
  if (lo.mcpServers.length > 0) doc.mcp_servers = lo.mcpServers;
  if (lo.mcpScope.length > 0) doc.mcp_scope = lo.mcpScope;

  const perms: Record<string, unknown> = {};
  if (lo.permissions.allow?.length) perms.allow = lo.permissions.allow;
  if (lo.permissions.deny?.length) perms.deny = lo.permissions.deny;
  if (lo.permissions.ask?.length) perms.ask = lo.permissions.ask;
  if (Object.keys(perms).length > 0) doc.permissions = perms;

  if (lo.promptAddendum) doc.prompt_addendum = lo.promptAddendum;
  return yaml.dump(doc, { lineWidth: 100, noRefs: true });
}

/**
 * Map each named loadout to the roles that reference it by slug.
 * Inline loadouts (`__inline:<role>`) are excluded — use
 * `listInlineLoadoutRoles` for those.
 */
export function listLoadoutConsumers(
  template: ResolvedTemplate
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const name of template.loadouts.keys()) {
    result.set(name, []);
  }
  for (const [roleName, role] of template.roles) {
    if (!role.loadout) continue;
    if (role.loadout.name.startsWith("__inline:")) continue;
    const existing = result.get(role.loadout.name);
    if (existing) existing.push(roleName);
  }
  return result;
}

/**
 * Return the role names that bind an inline loadout.
 */
export function listInlineLoadoutRoles(template: ResolvedTemplate): string[] {
  const roles: string[] = [];
  for (const [roleName, role] of template.roles) {
    if (role.loadout?.name.startsWith("__inline:")) roles.push(roleName);
  }
  return roles;
}
