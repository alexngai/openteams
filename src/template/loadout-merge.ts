// ─────────────────────────────────────────────────────────────
// Loadout Merge Semantics
// ─────────────────────────────────────────────────────────────
// Canonical merge rules applied when a child loadout extends a
// parent. Centralized here so every consumer (openteams loader,
// OpenHive DB overrides, runtime materializers) uses the same
// resolution algorithm.
//
// Rules:
//   skills.profile         — child replaces parent if set
//   skills.include         — union
//   skills.exclude         — union
//   skills.max_tokens      — child replaces parent if set
//   capabilities           — existing CapabilityComposition merge
//   mcp_servers            — union by `name` (or `ref`); child wins on conflict
//   permissions.allow      — union
//   permissions.ask        — union
//   permissions.deny       — union; deny always wins (child cannot drop parent denies)
//   prompt_addendum        — concatenate (parent, then child) with blank line

import type {
  CapabilityComposition,
  CapabilityMap,
  LoadoutDefinition,
  McpServerEntry,
  McpServerRef,
  PermissionsConfig,
  ResolvedLoadout,
  SkillsConfig,
} from "./types";

/**
 * Merge a child loadout onto a resolved parent loadout. Returns a new
 * ResolvedLoadout; does not mutate inputs.
 *
 * The child's raw LoadoutDefinition is the source of truth for child-side
 * data; the parent is already resolved (its own extends chain applied).
 */
export function mergeLoadout(
  parent: ResolvedLoadout,
  childDef: LoadoutDefinition
): ResolvedLoadout {
  const childCaps = normalizeCapabilities(childDef);

  return {
    name: childDef.name,
    extends: childDef.extends,
    description: childDef.description ?? parent.description,
    skills: mergeSkills(parent.skills, childDef.skills),
    capabilities: mergeCapabilityList(parent.capabilities, childCaps),
    capabilityConfig: mergeCapabilityConfig(
      parent.capabilityConfig,
      childDef.capabilities
    ),
    mcpServers: mergeMcpServers(parent.mcpServers, childDef.mcp_servers ?? []),
    permissions: mergePermissions(parent.permissions, childDef.permissions),
    promptAddendum: mergePromptAddendum(
      parent.promptAddendum,
      childDef.prompt_addendum
    ),
    raw: childDef,
  };
}

/**
 * Convert a raw LoadoutDefinition into a ResolvedLoadout with no parent.
 * Used for root loadouts (no `extends`) and as the baseline for inheritance.
 */
export function resolveStandaloneLoadout(def: LoadoutDefinition): ResolvedLoadout {
  const caps = normalizeCapabilities(def);
  const capabilityConfig = extractCapabilityMap(def.capabilities);

  return {
    name: def.name,
    extends: def.extends,
    description: def.description ?? `Loadout: ${def.name}`,
    skills: def.skills ? { ...def.skills } : undefined,
    capabilities: caps.list,
    capabilityConfig,
    mcpServers: [...(def.mcp_servers ?? [])],
    permissions: {
      allow: def.permissions?.allow ? [...def.permissions.allow] : undefined,
      deny: def.permissions?.deny ? [...def.permissions.deny] : undefined,
      ask: def.permissions?.ask ? [...def.permissions.ask] : undefined,
    },
    promptAddendum: def.prompt_addendum,
    raw: def,
  };
}

// ─────────────────────────────────────────────────────────────
// Capability handling
// ─────────────────────────────────────────────────────────────

interface NormalizedCaps {
  /** Flat cap list to use as this level's own contribution. */
  list: string[];
  /** Caps to add onto the parent (composition form). */
  add?: string[];
  /** Caps to remove from the parent (composition form). */
  remove?: string[];
  /** Whether the child provides a replacement (array or map) vs a composition. */
  replaces: boolean;
}

function normalizeCapabilities(def: LoadoutDefinition): NormalizedCaps {
  // Flat composition syntax takes precedence if present.
  if (def.capabilities_add || def.capabilities_remove) {
    return {
      list: def.capabilities_add ?? [],
      add: def.capabilities_add,
      remove: def.capabilities_remove,
      replaces: false,
    };
  }

  const caps = def.capabilities;
  if (caps === undefined) {
    return { list: [], replaces: false };
  }
  if (Array.isArray(caps)) {
    return { list: [...caps], replaces: true };
  }
  if (isCompositionObject(caps)) {
    return {
      list: caps.add ?? [],
      add: caps.add,
      remove: caps.remove,
      replaces: false,
    };
  }
  // CapabilityMap
  return { list: Object.keys(caps), replaces: true };
}

function isCompositionObject(
  value: unknown
): value is CapabilityComposition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.every((k) => k === "add" || k === "remove");
}

function mergeCapabilityList(
  parent: string[],
  child: NormalizedCaps
): string[] {
  if (child.replaces) {
    return [...child.list];
  }
  const toAdd = child.add ?? [];
  const toRemove = new Set(child.remove ?? []);
  const merged = [...new Set([...parent, ...toAdd])];
  return merged.filter((c) => !toRemove.has(c));
}

function extractCapabilityMap(
  caps: LoadoutDefinition["capabilities"]
): CapabilityMap | undefined {
  if (!caps || Array.isArray(caps) || isCompositionObject(caps)) return undefined;
  return caps as CapabilityMap;
}

function mergeCapabilityConfig(
  parent: CapabilityMap | undefined,
  childCaps: LoadoutDefinition["capabilities"]
): CapabilityMap | undefined {
  const childMap = extractCapabilityMap(childCaps);
  if (!parent && !childMap) return undefined;
  if (!parent) return childMap ? { ...childMap } : undefined;
  if (!childMap) return { ...parent };
  return { ...parent, ...childMap };
}

// ─────────────────────────────────────────────────────────────
// Skills
// ─────────────────────────────────────────────────────────────

function mergeSkills(
  parent: SkillsConfig | undefined,
  child: SkillsConfig | undefined
): SkillsConfig | undefined {
  if (!parent && !child) return undefined;
  if (!parent) return { ...child };
  if (!child) return { ...parent };

  return {
    profile: child.profile ?? parent.profile,
    include: unique([...(parent.include ?? []), ...(child.include ?? [])]),
    exclude: unique([...(parent.exclude ?? []), ...(child.exclude ?? [])]),
    max_tokens: child.max_tokens ?? parent.max_tokens,
  };
}

// ─────────────────────────────────────────────────────────────
// MCP servers
// ─────────────────────────────────────────────────────────────

function mcpServerKey(entry: McpServerEntry | McpServerRef): string {
  if ("ref" in entry) return `ref:${entry.ref}`;
  return `name:${entry.name}`;
}

function mergeMcpServers(
  parent: (McpServerEntry | McpServerRef)[],
  child: (McpServerEntry | McpServerRef)[]
): (McpServerEntry | McpServerRef)[] {
  const byKey = new Map<string, McpServerEntry | McpServerRef>();
  for (const entry of parent) byKey.set(mcpServerKey(entry), entry);
  for (const entry of child) byKey.set(mcpServerKey(entry), entry); // child overrides
  return [...byKey.values()];
}

// ─────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────

function mergePermissions(
  parent: PermissionsConfig,
  child: PermissionsConfig | undefined
): PermissionsConfig {
  if (!child) {
    return {
      allow: parent.allow ? [...parent.allow] : undefined,
      deny: parent.deny ? [...parent.deny] : undefined,
      ask: parent.ask ? [...parent.ask] : undefined,
    };
  }
  return {
    allow: unique([...(parent.allow ?? []), ...(child.allow ?? [])]),
    // Deny always wins — parent's denies cannot be dropped by child.
    deny: unique([...(parent.deny ?? []), ...(child.deny ?? [])]),
    ask: unique([...(parent.ask ?? []), ...(child.ask ?? [])]),
  };
}

// ─────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────

function mergePromptAddendum(
  parent: string | undefined,
  child: string | undefined
): string | undefined {
  if (!parent && !child) return undefined;
  if (!parent) return child;
  if (!child) return parent;
  return `${parent}\n\n${child}`;
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function unique(items: string[]): string[] | undefined {
  if (items.length === 0) return undefined;
  return [...new Set(items)];
}
