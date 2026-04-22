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
  McpServerEntry,
  McpServerRef,
  PermissionsConfig,
  ResolvedLoadout,
  ResolvedTemplate,
  SkillsConfig,
} from "../template/types";

/**
 * Runtime-agnostic view of a loadout. Inline MCP entries and symbolic
 * refs are split so consumers know which entries need resolution via
 * their own registry.
 */
export interface LoadoutArtifacts {
  name: string;
  description: string;
  capabilities: string[];
  /** MCP servers with inline command/args/env. Write these directly. */
  mcpServers: McpServerEntry[];
  /** MCP server refs. Consumer must resolve each against its own registry. */
  mcpServerRefs: McpServerRef[];
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
