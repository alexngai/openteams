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
  McpServerScopeOpts,
  NormalizedMcpScope,
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
  const childMcp = normalizeMcpEntries(childDef.mcp_servers ?? []);

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
    mcpServers: mergeMcpInstalls(parent.mcpServers ?? [], childMcp.installs),
    mcpScope: mergeMcpScope(parent.mcpScope ?? [], childMcp.scopes),
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
  const { installs, scopes } = normalizeMcpEntries(def.mcp_servers ?? []);

  return {
    name: def.name,
    extends: def.extends,
    description: def.description ?? `Loadout: ${def.name}`,
    skills: def.skills ? { ...def.skills } : undefined,
    capabilities: caps.list,
    capabilityConfig,
    mcpServers: installs,
    mcpScope: scopes,
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
// MCP entry normalization + scope/install merge
// ─────────────────────────────────────────────────────────────

/**
 * Classify a raw entry from `mcp_servers` into one of four known shapes.
 * Pure function — no side effects.
 */
type McpEntryKind = "string" | "scope-obj" | "install" | "ref" | "unknown";

function classifyMcpEntry(raw: unknown): McpEntryKind {
  if (typeof raw === "string") return "string";
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "unknown";
  const obj = raw as Record<string, unknown>;
  if ("ref" in obj && typeof obj.ref === "string") return "ref";
  if ("name" in obj && "command" in obj) return "install";
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const val = obj[keys[0]];
    if (Array.isArray(val)) return "scope-obj";
    if (val === null) return "scope-obj";
    if (typeof val === "object") return "scope-obj";
  }
  return "unknown";
}

/**
 * Normalize a raw `mcp_servers` list into two buckets:
 *   - installs: McpServerEntry + McpServerRef entries preserved verbatim
 *   - scopes:   NormalizedMcpScope for every referenced server
 *
 * String + scope-object entries produce scope-only output.
 * Install entries produce BOTH an install spec AND a full-scope entry
 * (install implies the role uses the server with no restrictions).
 * Ref entries produce only an install entry; scope is deferred until
 * the consumer resolves the ref.
 */
export function normalizeMcpEntries(raw: unknown[]): {
  installs: (McpServerEntry | McpServerRef)[];
  scopes: NormalizedMcpScope[];
} {
  const installs: (McpServerEntry | McpServerRef)[] = [];
  const scopes: NormalizedMcpScope[] = [];

  for (const entry of raw) {
    switch (classifyMcpEntry(entry)) {
      case "string": {
        scopes.push({ server: entry as string });
        break;
      }
      case "scope-obj": {
        const obj = entry as Record<string, unknown>;
        const server = Object.keys(obj)[0];
        const val = obj[server];
        if (Array.isArray(val)) {
          scopes.push({ server, tools: [...(val as string[])] });
        } else if (val && typeof val === "object") {
          const opts = val as McpServerScopeOpts;
          const out: NormalizedMcpScope = { server };
          if (opts.tools) out.tools = [...opts.tools];
          if (opts.exclude) out.exclude = [...opts.exclude];
          scopes.push(out);
        } else {
          scopes.push({ server });
        }
        break;
      }
      case "install": {
        const e = entry as McpServerEntry;
        installs.push({ ...e });
        scopes.push({ server: e.name });
        break;
      }
      case "ref": {
        const e = entry as McpServerRef;
        installs.push({ ...e });
        // Scope deferred — consumer resolves ref then infers server name.
        break;
      }
      default:
        throw new Error(
          `Unrecognized mcp_servers entry shape: ${JSON.stringify(entry)}`
        );
    }
  }

  return { installs, scopes };
}

function mcpInstallKey(entry: McpServerEntry | McpServerRef): string {
  if ("ref" in entry) return `ref:${entry.ref}`;
  return `name:${entry.name}`;
}

/**
 * Merge install specs: union by name/ref, child wins on conflict.
 */
function mergeMcpInstalls(
  parent: (McpServerEntry | McpServerRef)[],
  child: (McpServerEntry | McpServerRef)[]
): (McpServerEntry | McpServerRef)[] {
  const byKey = new Map<string, McpServerEntry | McpServerRef>();
  for (const entry of parent) byKey.set(mcpInstallKey(entry), entry);
  for (const entry of child) byKey.set(mcpInstallKey(entry), entry);
  return [...byKey.values()];
}

/**
 * Merge scope declarations: union by server name.
 *
 * Per-server field semantics:
 *   tools   — union (both sides' allowlists accumulate). A child whose
 *             entry has no `tools` field does NOT unrestrict a parent's
 *             restriction; to widen, the child must explicitly list tools.
 *   exclude — union (deny-wins). Child cannot drop a parent exclude.
 *
 * Omitted fields on both sides → the merged entry has neither field
 * (equivalent to "full access to this server").
 */
function mergeMcpScope(
  parent: NormalizedMcpScope[],
  child: NormalizedMcpScope[]
): NormalizedMcpScope[] {
  const byServer = new Map<string, NormalizedMcpScope>();
  for (const s of parent) byServer.set(s.server, cloneScope(s));
  for (const s of child) {
    const existing = byServer.get(s.server);
    if (!existing) {
      byServer.set(s.server, cloneScope(s));
      continue;
    }
    const merged: NormalizedMcpScope = { server: s.server };
    const tools = unique([...(existing.tools ?? []), ...(s.tools ?? [])]);
    if (tools) merged.tools = tools;
    const exclude = unique([...(existing.exclude ?? []), ...(s.exclude ?? [])]);
    if (exclude) merged.exclude = exclude;
    byServer.set(s.server, merged);
  }
  return [...byServer.values()];
}

function cloneScope(s: NormalizedMcpScope): NormalizedMcpScope {
  const out: NormalizedMcpScope = { server: s.server };
  if (s.tools) out.tools = [...s.tools];
  if (s.exclude) out.exclude = [...s.exclude];
  return out;
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
