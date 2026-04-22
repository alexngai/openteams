import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type {
  TeamManifest,
  RoleDefinition,
  ResolvedTemplate,
  ResolvedRole,
  ResolvedPrompts,
  PromptSection,
  CapabilityComposition,
  CapabilityMap,
  SpawnRuleEntry,
  McpServerEntry,
  LoadOptions,
  AsyncLoadOptions,
  LoadoutDefinition,
  ResolvedLoadout,
} from "./types";
import { mergeLoadout, resolveStandaloneLoadout } from "./loadout-merge";
import { isTemplateName, listBuiltinTemplates } from "./builtins";
import type { BuiltinTemplateInfo } from "./builtins";
import { resolveTemplateName, listAllTemplates } from "./resolver";
import type { TemplateInfo } from "./types";

/**
 * Extract the role name from a SpawnRuleEntry (string or { role, max_instances? }).
 */
export function spawnRuleTarget(entry: SpawnRuleEntry): string {
  return typeof entry === "string" ? entry : entry.role;
}

/**
 * Detect whether a capabilities value is a CapabilityMap (map form).
 *
 * Distinguishes from CapabilityComposition by checking that the object
 * does NOT have only "add"/"remove" keys — i.e. it has at least one key
 * that isn't "add" or "remove", OR all values are null/plain objects
 * (not arrays like add/remove would be).
 */
export function isCapabilityMap(
  caps: Record<string, unknown>
): caps is CapabilityMap {
  const keys = Object.keys(caps);
  if (keys.length === 0) return true; // empty map is valid
  // CapabilityComposition has only "add" and/or "remove" keys with array values
  const compositionKeys = new Set(["add", "remove"]);
  const allKeysAreComposition = keys.every((k) => compositionKeys.has(k));
  if (allKeysAreComposition) {
    // Check if values are arrays (CapabilityComposition) vs objects/null (CapabilityMap)
    return keys.some(
      (k) => !Array.isArray(caps[k]) && caps[k] !== undefined
    );
  }
  return true;
}

export class TemplateLoader {
  /**
   * Load a team template from a directory.
   * Expects: team.yaml, optional roles/*.yaml, optional prompts/*.md
   *
   * @param templateDir - Absolute or relative path to the template directory
   * @param options - Optional hooks for external role resolution and post-processing
   */
  static load(templateDir: string, options?: LoadOptions): ResolvedTemplate {
    const { manifest, roles, prompts, mcpServers, loadoutDefs, absDir } =
      TemplateLoader.loadCore(templateDir);

    // Resolve role inheritance chains (with optional external resolution)
    TemplateLoader.resolveInheritance(roles, options?.resolveExternalRole);

    // Resolve loadout inheritance chains
    const loadouts = TemplateLoader.resolveLoadoutInheritance(
      loadoutDefs,
      options?.resolveExternalLoadout
    );

    // Post-process each role if hook provided
    if (options?.postProcessRole) {
      for (const [name, role] of roles) {
        roles.set(name, options.postProcessRole(role, manifest));
      }
    }

    // Post-process each loadout if hook provided
    if (options?.postProcessLoadout) {
      for (const [name, lo] of loadouts) {
        loadouts.set(name, options.postProcessLoadout(lo, manifest));
      }
    }

    // Attach loadouts to roles (handles both slug refs and inline defs)
    TemplateLoader.attachLoadoutsToRoles(
      roles,
      loadouts,
      options?.resolveExternalLoadout
    );

    // Load prompts
    for (const roleName of manifest.roles) {
      const resolved = TemplateLoader.loadPromptsForRole(
        absDir,
        roleName,
        manifest,
        roles.get(roleName)
      );
      if (resolved) {
        prompts.set(roleName, resolved);
      }
    }

    let result: ResolvedTemplate = {
      manifest,
      roles,
      prompts,
      mcpServers,
      loadouts,
      sourcePath: absDir,
    };

    if (options?.postProcess) {
      result = options.postProcess(result);
    }

    return result;
  }

  /**
   * Async variant of load(). Identical file I/O but hooks may return Promises.
   *
   * @param templateDir - Absolute or relative path to the template directory
   * @param options - Optional async hooks for external role resolution and post-processing
   */
  static async loadAsync(
    templateDir: string,
    options?: AsyncLoadOptions
  ): Promise<ResolvedTemplate> {
    const { manifest, roles, prompts, mcpServers, loadoutDefs, absDir } =
      TemplateLoader.loadCore(templateDir);

    // Resolve role inheritance chains (with optional async external resolution)
    await TemplateLoader.resolveInheritanceAsync(
      roles,
      options?.resolveExternalRole
    );

    // Resolve loadout inheritance chains
    const loadouts = await TemplateLoader.resolveLoadoutInheritanceAsync(
      loadoutDefs,
      options?.resolveExternalLoadout
    );

    // Post-process each role if hook provided
    if (options?.postProcessRole) {
      for (const [name, role] of roles) {
        roles.set(name, await options.postProcessRole(role, manifest));
      }
    }

    // Post-process each loadout if hook provided
    if (options?.postProcessLoadout) {
      for (const [name, lo] of loadouts) {
        loadouts.set(name, await options.postProcessLoadout(lo, manifest));
      }
    }

    // Attach loadouts to roles (handles both slug refs and inline defs)
    await TemplateLoader.attachLoadoutsToRolesAsync(
      roles,
      loadouts,
      options?.resolveExternalLoadout
    );

    // Load prompts
    for (const roleName of manifest.roles) {
      const resolved = TemplateLoader.loadPromptsForRole(
        absDir,
        roleName,
        manifest,
        roles.get(roleName)
      );
      if (resolved) {
        prompts.set(roleName, resolved);
      }
    }

    let result: ResolvedTemplate = {
      manifest,
      roles,
      prompts,
      mcpServers,
      loadouts,
      sourcePath: absDir,
    };

    if (options?.postProcess) {
      result = await options.postProcess(result);
    }

    return result;
  }

  /**
   * Core loading logic shared by load() and loadAsync().
   * Reads filesystem and parses YAML — no hooks called.
   */
  private static loadCore(templateDir: string): {
    manifest: TeamManifest;
    roles: Map<string, ResolvedRole>;
    prompts: Map<string, ResolvedPrompts>;
    mcpServers: Map<string, McpServerEntry[]>;
    loadoutDefs: Map<string, LoadoutDefinition>;
    absDir: string;
  } {
    let absDir = path.resolve(templateDir);

    // If the resolved path doesn't exist and the input looks like a
    // template name (not a path), try unified resolution (installed > built-in)
    if (!fs.existsSync(absDir) && isTemplateName(templateDir)) {
      const resolved = resolveTemplateName(templateDir);
      if (resolved) {
        absDir = resolved;
      }
    }

    if (!fs.existsSync(absDir)) {
      const hint = isTemplateName(templateDir)
        ? ` (not found as an installed or built-in template; use "openteams template list" to see available templates)`
        : "";
      throw new Error(`Template directory not found: ${absDir}${hint}`);
    }

    const manifestPath = path.join(absDir, "team.yaml");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`team.yaml not found in ${absDir}`);
    }

    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    const manifest = yaml.load(manifestContent) as TeamManifest;

    TemplateLoader.validateManifest(manifest);

    const roles = new Map<string, ResolvedRole>();
    const prompts = new Map<string, ResolvedPrompts>();

    // Load role definitions
    for (const roleName of manifest.roles) {
      const rolePath = path.join(absDir, "roles", `${roleName}.yaml`);
      if (fs.existsSync(rolePath)) {
        const roleContent = fs.readFileSync(rolePath, "utf-8");
        const roleDef = yaml.load(roleContent) as RoleDefinition;
        roles.set(roleName, TemplateLoader.resolveRole(roleDef));
      } else {
        // Implicit role — just the name, no definition file
        roles.set(roleName, {
          name: roleName,
          displayName: roleName,
          description: `Role: ${roleName}`,
          capabilities: [],
          raw: { name: roleName },
        });
      }
    }

    // Load MCP server configs
    const mcpServers = TemplateLoader.loadMcpServers(absDir);

    // Load raw loadout definitions (inheritance resolved later in load()/loadAsync())
    const loadoutDefs = TemplateLoader.loadLoadoutDefinitions(absDir);

    return { manifest, roles, prompts, mcpServers, loadoutDefs, absDir };
  }

  /**
   * Load a template from an inline manifest object (no filesystem).
   * Used for programmatic/test scenarios.
   */
  static loadFromManifest(manifest: TeamManifest): ResolvedTemplate {
    TemplateLoader.validateManifest(manifest);

    const roles = new Map<string, ResolvedRole>();
    for (const roleName of manifest.roles) {
      roles.set(roleName, {
        name: roleName,
        displayName: roleName,
        description: `Role: ${roleName}`,
        capabilities: [],
        raw: { name: roleName },
      });
    }

    return {
      manifest,
      roles,
      prompts: new Map(),
      mcpServers: new Map(),
      loadouts: new Map(),
      sourcePath: "",
    };
  }

  /**
   * List all available built-in templates that ship with the package.
   */
  static listBuiltins(): BuiltinTemplateInfo[] {
    return listBuiltinTemplates();
  }

  /**
   * List all available templates from all sources (installed, built-in).
   */
  static listAll(): TemplateInfo[] {
    return listAllTemplates();
  }

  private static validateManifest(manifest: TeamManifest): void {
    if (!manifest.name) {
      throw new Error("Template manifest missing required field: name");
    }
    if (!manifest.version) {
      throw new Error("Template manifest missing required field: version");
    }
    if (!manifest.roles || !Array.isArray(manifest.roles) || manifest.roles.length === 0) {
      throw new Error("Template manifest must define at least one role");
    }
    if (!manifest.topology?.root?.role) {
      throw new Error("Template manifest must define topology.root.role");
    }

    // Validate all topology references point to declared roles
    const declaredRoles = new Set(manifest.roles);

    if (!declaredRoles.has(manifest.topology.root.role)) {
      throw new Error(
        `topology.root.role "${manifest.topology.root.role}" is not in the roles list`
      );
    }

    if (manifest.topology.companions) {
      for (const comp of manifest.topology.companions) {
        if (!declaredRoles.has(comp.role)) {
          throw new Error(
            `topology.companions role "${comp.role}" is not in the roles list`
          );
        }
      }
    }

    if (manifest.topology.spawn_rules) {
      for (const [from, targets] of Object.entries(manifest.topology.spawn_rules)) {
        if (!declaredRoles.has(from)) {
          throw new Error(
            `spawn_rules key "${from}" is not in the roles list`
          );
        }
        for (const entry of targets) {
          const target = spawnRuleTarget(entry);
          if (!declaredRoles.has(target)) {
            throw new Error(
              `spawn_rules "${from}" references unknown role "${target}"`
            );
          }
          // Validate max_instances if present
          if (typeof entry === "object") {
            if (entry.max_instances !== undefined) {
              if (!Number.isInteger(entry.max_instances) || entry.max_instances < 1) {
                throw new Error(
                  `spawn_rules "${from}" → "${target}" has invalid max_instances: must be a positive integer`
                );
              }
            }
          }
        }
      }
    }

    // Validate communication references
    if (manifest.communication) {
      const channels = manifest.communication.channels
        ? new Set(Object.keys(manifest.communication.channels))
        : new Set<string>();

      if (manifest.communication.subscriptions) {
        for (const [role, subs] of Object.entries(manifest.communication.subscriptions)) {
          if (!declaredRoles.has(role)) {
            throw new Error(
              `communication.subscriptions key "${role}" is not in the roles list`
            );
          }
          for (const sub of subs) {
            if (!channels.has(sub.channel)) {
              throw new Error(
                `subscription for "${role}" references unknown channel "${sub.channel}"`
              );
            }
          }
        }
      }

      if (manifest.communication.emissions) {
        for (const role of Object.keys(manifest.communication.emissions)) {
          if (!declaredRoles.has(role)) {
            throw new Error(
              `communication.emissions key "${role}" is not in the roles list`
            );
          }
        }
      }

      if (manifest.communication.routing?.peers) {
        for (const peer of manifest.communication.routing.peers) {
          if (!declaredRoles.has(peer.from)) {
            throw new Error(
              `routing.peers.from "${peer.from}" is not in the roles list`
            );
          }
          if (!declaredRoles.has(peer.to)) {
            throw new Error(
              `routing.peers.to "${peer.to}" is not in the roles list`
            );
          }
        }
      }

      // Validate exports reference emitted signals
      if (manifest.communication.exports) {
        const allEmittedSignals = new Set(
          Object.values(manifest.communication.emissions ?? {}).flat()
        );
        for (const exp of manifest.communication.exports) {
          if (allEmittedSignals.size > 0 && !allEmittedSignals.has(exp.signal)) {
            throw new Error(
              `communication.exports signal "${exp.signal}" is not emitted by any role`
            );
          }
        }
      }

      // Validate imports reference declared channels
      if (manifest.communication.imports) {
        for (const imp of manifest.communication.imports) {
          if (channels.size > 0 && !channels.has(imp.channel)) {
            throw new Error(
              `communication.imports channel "${imp.channel}" is not defined in channels`
            );
          }
          // Validate import signals exist in the channel definition
          if (channels.has(imp.channel)) {
            const channelDef = manifest.communication.channels![imp.channel];
            for (const sig of imp.signals) {
              if (!channelDef.signals.includes(sig)) {
                throw new Error(
                  `communication.imports signal "${sig}" is not defined in channel "${imp.channel}"`
                );
              }
            }
          }
        }
      }
    }
  }

  /**
   * Merge a child role's capabilities with its parent using CapabilityComposition.
   */
  private static mergeCapabilities(
    role: ResolvedRole,
    parentRole: ResolvedRole
  ): void {
    const raw = role.raw;
    if (raw.capabilities && !Array.isArray(raw.capabilities) &&
        !isCapabilityMap(raw.capabilities as Record<string, unknown>)) {
      // CapabilityComposition — merge with parent
      const comp = raw.capabilities as CapabilityComposition;
      const parentCaps = [...parentRole.capabilities];
      const toAdd = comp.add ?? [];
      const toRemove = new Set(comp.remove ?? []);

      // Start with parent caps, add child additions, remove exclusions
      const merged = [...new Set([...parentCaps, ...toAdd])];
      role.capabilities = merged.filter((c) => !toRemove.has(c));

      // Inherit capabilityConfig from parent for retained capabilities
      if (parentRole.capabilityConfig) {
        const inherited: CapabilityMap = {};
        for (const cap of role.capabilities) {
          if (cap in parentRole.capabilityConfig) {
            inherited[cap] = parentRole.capabilityConfig[cap];
          }
        }
        if (Object.keys(inherited).length > 0) {
          role.capabilityConfig = inherited;
        }
      }
    }
    // If capabilities is a plain array or map form, it's an explicit override — keep as-is
  }

  /**
   * Resolve external parents: for roles that `extends` a name not in the local map,
   * call the resolver hook to get the parent ResolvedRole.
   * Returns a map of external parent name → ResolvedRole.
   */
  private static resolveExternalParents(
    roles: Map<string, ResolvedRole>,
    resolver?: (name: string) => ResolvedRole | null
  ): Map<string, ResolvedRole> {
    const externals = new Map<string, ResolvedRole>();
    if (!resolver) return externals;

    for (const [, role] of roles) {
      if (role.extends && !roles.has(role.extends) && !externals.has(role.extends)) {
        const external = resolver(role.extends);
        if (external) {
          externals.set(role.extends, external);
        }
      }
    }
    return externals;
  }

  /**
   * Resolve external parents (async variant).
   */
  private static async resolveExternalParentsAsync(
    roles: Map<string, ResolvedRole>,
    resolver?: (name: string) => Promise<ResolvedRole | null> | ResolvedRole | null
  ): Promise<Map<string, ResolvedRole>> {
    const externals = new Map<string, ResolvedRole>();
    if (!resolver) return externals;

    for (const [, role] of roles) {
      if (role.extends && !roles.has(role.extends) && !externals.has(role.extends)) {
        const external = await resolver(role.extends);
        if (external) {
          externals.set(role.extends, external);
        }
      }
    }
    return externals;
  }

  /**
   * Core inheritance resolution logic. Operates on a combined map of
   * local + external parent roles.
   */
  private static resolveInheritanceCore(
    roles: Map<string, ResolvedRole>,
    allRoles: Map<string, ResolvedRole>
  ): void {
    // Build dependency map: child -> parent (only for parents resolvable in allRoles)
    const extendsMap = new Map<string, string>();
    for (const [name, role] of roles) {
      if (role.extends && allRoles.has(role.extends)) {
        extendsMap.set(name, role.extends);
      }
    }

    if (extendsMap.size === 0) return;

    // Detect cycles by following chains (only through local roles)
    for (const startName of extendsMap.keys()) {
      const chain: string[] = [];
      let current: string | undefined = startName;
      while (current) {
        if (chain.includes(current)) {
          const cycleStart = chain.indexOf(current);
          const cyclePath = [...chain.slice(cycleStart), current].join(" -> ");
          throw new Error(`Circular role inheritance detected: ${cyclePath}`);
        }
        chain.push(current);
        current = extendsMap.get(current);
      }
    }

    // Resolve in topological order (parents before children)
    const resolved = new Set<string>();

    const resolve = (name: string): void => {
      if (resolved.has(name)) return;

      const parent = extendsMap.get(name);
      if (parent && roles.has(parent)) {
        resolve(parent);
      }

      const role = roles.get(name)!;
      if (parent) {
        const parentRole = allRoles.get(parent)!;
        TemplateLoader.mergeCapabilities(role, parentRole);
      }

      resolved.add(name);
    };

    for (const name of extendsMap.keys()) {
      resolve(name);
    }
  }

  /**
   * Resolve role inheritance chains. For each role with `extends` pointing
   * to another role in the map (or resolvable via external resolver),
   * merge parent capabilities with the child's add/remove composition.
   * Detects circular inheritance.
   *
   * @param resolveExternalRole - Optional hook to resolve roles not in the local map
   */
  private static resolveInheritance(
    roles: Map<string, ResolvedRole>,
    resolveExternalRole?: (name: string) => ResolvedRole | null
  ): void {
    const externals = TemplateLoader.resolveExternalParents(roles, resolveExternalRole);
    const allRoles = new Map([...roles, ...externals]);
    TemplateLoader.resolveInheritanceCore(roles, allRoles);
  }

  /**
   * Async variant of resolveInheritance.
   */
  private static async resolveInheritanceAsync(
    roles: Map<string, ResolvedRole>,
    resolveExternalRole?: (name: string) => Promise<ResolvedRole | null> | ResolvedRole | null
  ): Promise<void> {
    const externals = await TemplateLoader.resolveExternalParentsAsync(roles, resolveExternalRole);
    const allRoles = new Map([...roles, ...externals]);
    TemplateLoader.resolveInheritanceCore(roles, allRoles);
  }

  /**
   * Normalize a role definition's capability fields into a canonical form.
   *
   * Supports two syntaxes for capability composition:
   *   1. `capabilities: { add: [...], remove: [...] }` (CapabilityComposition)
   *   2. `capabilities_add: [...]` / `capabilities_remove: [...]` (flat fields)
   *
   * Both are normalized into CapabilityComposition on `raw.capabilities` so that
   * `resolveInheritance()` has a single code path.
   *
   * Validation: errors if both syntaxes are used simultaneously.
   */
  private static normalizeRoleDefinition(def: RoleDefinition): RoleDefinition {
    const hasFlatFields = def.capabilities_add !== undefined || def.capabilities_remove !== undefined;

    // Detect what kind of capabilities value we have
    const isArray = Array.isArray(def.capabilities);
    const isObject = def.capabilities != null && typeof def.capabilities === "object" && !isArray;
    const isMap = isObject && isCapabilityMap(def.capabilities as Record<string, unknown>);
    const hasComposition = isObject && !isMap;

    if ((hasComposition || isMap) && hasFlatFields) {
      throw new Error(
        `Role "${def.name}" uses both CapabilityComposition in "capabilities" and flat ` +
        `"capabilities_add"/"capabilities_remove" fields. Use one syntax or the other.`
      );
    }

    // Normalize flat fields into CapabilityComposition on the capabilities field
    if (hasFlatFields) {
      const normalized = { ...def };
      normalized.capabilities = {
        add: def.capabilities_add,
        remove: def.capabilities_remove,
      } as CapabilityComposition;
      delete normalized.capabilities_add;
      delete normalized.capabilities_remove;
      return normalized;
    }

    return def;
  }

  private static resolveRole(def: RoleDefinition): ResolvedRole {
    // Normalize flat capabilities_add/remove into CapabilityComposition
    const normalized = TemplateLoader.normalizeRoleDefinition(def);
    let capabilities: string[] = [];
    let capabilityConfig: CapabilityMap | undefined;

    if (normalized.capabilities) {
      if (Array.isArray(normalized.capabilities)) {
        capabilities = normalized.capabilities;
      } else if (isCapabilityMap(normalized.capabilities as Record<string, unknown>)) {
        // Map form — keys are capability tokens, values are config objects
        const map = normalized.capabilities as CapabilityMap;
        capabilities = Object.keys(map);
        capabilityConfig = map;
      } else {
        // CapabilityComposition — resolve against parent later if extends is used.
        // For now, just collect the add list.
        const comp = normalized.capabilities as CapabilityComposition;
        capabilities = comp.add ?? [];
        // remove is applied when composing with parent; tracked in raw for later
      }
    }

    const result: ResolvedRole = {
      name: normalized.name,
      extends: normalized.extends,
      displayName: normalized.display_name ?? normalized.name,
      description: normalized.description ?? `Role: ${normalized.name}`,
      capabilities,
      promptFile: normalized.prompt,
      promptFiles: normalized.prompts,
      raw: normalized,
    };

    if (capabilityConfig) {
      result.capabilityConfig = capabilityConfig;
    }

    return result;
  }

  /**
   * Load tools/mcp-servers.json if present.
   * Returns a map of role name → MCP server entries.
   */
  private static loadMcpServers(
    absDir: string
  ): Map<string, McpServerEntry[]> {
    const result = new Map<string, McpServerEntry[]>();
    const mcpPath = path.join(absDir, "tools", "mcp-servers.json");

    if (!fs.existsSync(mcpPath)) {
      return result;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(mcpPath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read ${mcpPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let parsed: Record<string, { servers: McpServerEntry[] }>;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse ${mcpPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    for (const [roleName, config] of Object.entries(parsed)) {
      if (config.servers && Array.isArray(config.servers)) {
        result.set(roleName, config.servers);
      }
    }

    return result;
  }

  /**
   * Load raw loadout definitions from loadouts/*.yaml.
   * Returns a map of loadout name → LoadoutDefinition (pre-inheritance).
   */
  private static loadLoadoutDefinitions(
    absDir: string
  ): Map<string, LoadoutDefinition> {
    const result = new Map<string, LoadoutDefinition>();
    const dir = path.join(absDir, "loadouts");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return result;

    const files = fs.readdirSync(dir).filter((f) =>
      f.endsWith(".yaml") || f.endsWith(".yml")
    );

    for (const file of files) {
      const full = path.join(dir, file);
      const raw = fs.readFileSync(full, "utf-8");
      const def = yaml.load(raw) as LoadoutDefinition | null;
      if (!def || typeof def !== "object") continue;

      const stem = path.basename(file, path.extname(file));
      if (!def.name) def.name = stem;
      if (def.name !== stem) {
        throw new Error(
          `Loadout file "${file}" declares name "${def.name}" — must match filename stem "${stem}"`
        );
      }
      if (result.has(def.name)) {
        throw new Error(`Duplicate loadout name "${def.name}"`);
      }
      result.set(def.name, def);
    }

    return result;
  }

  /**
   * Resolve loadout inheritance chains using the canonical merge rules.
   * Parents can be resolved via the external resolver if not in the local map.
   * Detects circular inheritance.
   */
  private static resolveLoadoutInheritance(
    defs: Map<string, LoadoutDefinition>,
    resolveExternal?: (name: string) => ResolvedLoadout | null
  ): Map<string, ResolvedLoadout> {
    return TemplateLoader.resolveLoadoutInheritanceCore(defs, (name) =>
      resolveExternal ? resolveExternal(name) : null
    );
  }

  private static async resolveLoadoutInheritanceAsync(
    defs: Map<string, LoadoutDefinition>,
    resolveExternal?: (
      name: string
    ) => Promise<ResolvedLoadout | null> | ResolvedLoadout | null
  ): Promise<Map<string, ResolvedLoadout>> {
    // Pre-resolve external parents up front so the core can be synchronous.
    const externals = new Map<string, ResolvedLoadout>();
    if (resolveExternal) {
      const wanted = new Set<string>();
      for (const def of defs.values()) {
        if (def.extends && !defs.has(def.extends)) wanted.add(def.extends);
      }
      for (const name of wanted) {
        const ext = await resolveExternal(name);
        if (ext) externals.set(name, ext);
      }
    }
    return TemplateLoader.resolveLoadoutInheritanceCore(defs, (name) =>
      externals.get(name) ?? null
    );
  }

  /**
   * Core loadout-inheritance resolution. Synchronous. Walks extends chains
   * in topological order, applying mergeLoadout at each step. Cycles are
   * detected and rejected.
   */
  private static resolveLoadoutInheritanceCore(
    defs: Map<string, LoadoutDefinition>,
    getExternal: (name: string) => ResolvedLoadout | null
  ): Map<string, ResolvedLoadout> {
    const resolved = new Map<string, ResolvedLoadout>();

    // Cycle detection — follow each chain through local defs
    for (const startName of defs.keys()) {
      const chain: string[] = [];
      let current: string | undefined = startName;
      while (current) {
        if (chain.includes(current)) {
          const cycleStart = chain.indexOf(current);
          const cyclePath = [...chain.slice(cycleStart), current].join(" -> ");
          throw new Error(`Circular loadout inheritance detected: ${cyclePath}`);
        }
        chain.push(current);
        const def = defs.get(current);
        current = def?.extends && defs.has(def.extends) ? def.extends : undefined;
      }
    }

    const resolve = (name: string): ResolvedLoadout => {
      const existing = resolved.get(name);
      if (existing) return existing;

      const def = defs.get(name);
      if (!def) {
        const ext = getExternal(name);
        if (!ext) {
          throw new Error(`Loadout "${name}" not found (not in local map, no external resolver hit)`);
        }
        resolved.set(name, ext);
        return ext;
      }

      let out: ResolvedLoadout;
      if (def.extends) {
        const parent = defs.has(def.extends)
          ? resolve(def.extends)
          : getExternal(def.extends);
        if (!parent) {
          throw new Error(
            `Loadout "${def.name}" extends unknown loadout "${def.extends}"`
          );
        }
        out = mergeLoadout(parent, def);
      } else {
        out = resolveStandaloneLoadout(def);
      }
      resolved.set(name, out);
      return out;
    };

    for (const name of defs.keys()) resolve(name);
    return resolved;
  }

  /**
   * Attach a ResolvedLoadout to each role whose raw.loadout is set.
   * Supports both slug references (string) and inline definitions (object).
   */
  private static attachLoadoutsToRoles(
    roles: Map<string, ResolvedRole>,
    loadouts: Map<string, ResolvedLoadout>,
    resolveExternal?: (name: string) => ResolvedLoadout | null
  ): void {
    for (const role of roles.values()) {
      const ref = role.raw.loadout;
      if (ref === undefined) continue;
      role.loadout = TemplateLoader.resolveRoleLoadoutRef(
        role.name,
        ref,
        loadouts,
        (name) => (resolveExternal ? resolveExternal(name) : null)
      );
    }
  }

  private static async attachLoadoutsToRolesAsync(
    roles: Map<string, ResolvedRole>,
    loadouts: Map<string, ResolvedLoadout>,
    resolveExternal?: (
      name: string
    ) => Promise<ResolvedLoadout | null> | ResolvedLoadout | null
  ): Promise<void> {
    for (const role of roles.values()) {
      const ref = role.raw.loadout;
      if (ref === undefined) continue;

      // Pre-resolve any external parent needed by an inline def (or by the slug itself).
      let external: ResolvedLoadout | null = null;
      if (typeof ref === "string" && !loadouts.has(ref) && resolveExternal) {
        external = (await resolveExternal(ref)) ?? null;
      } else if (typeof ref === "object" && ref.extends && !loadouts.has(ref.extends) && resolveExternal) {
        external = (await resolveExternal(ref.extends)) ?? null;
      }

      role.loadout = TemplateLoader.resolveRoleLoadoutRef(
        role.name,
        ref,
        loadouts,
        (name) => {
          if (typeof ref === "string" && name === ref) return external;
          if (typeof ref === "object" && name === ref.extends) return external;
          return null;
        }
      );
    }
  }

  /**
   * Resolve a single role's loadout reference (slug or inline def) into
   * a concrete ResolvedLoadout. Shared by sync and async attach paths.
   */
  private static resolveRoleLoadoutRef(
    roleName: string,
    ref: string | LoadoutDefinition,
    loadouts: Map<string, ResolvedLoadout>,
    getExternal: (name: string) => ResolvedLoadout | null
  ): ResolvedLoadout {
    if (typeof ref === "string") {
      const found = loadouts.get(ref);
      if (found) return found;
      const external = getExternal(ref);
      if (external) return external;
      throw new Error(
        `Role "${roleName}" references unknown loadout "${ref}"`
      );
    }

    // Inline definition — assign a synthetic name if absent.
    const def: LoadoutDefinition = {
      ...ref,
      name: ref.name ?? `__inline:${roleName}`,
    };

    if (def.extends) {
      const parent = loadouts.get(def.extends) ?? getExternal(def.extends);
      if (!parent) {
        throw new Error(
          `Role "${roleName}" inline loadout extends unknown loadout "${def.extends}"`
        );
      }
      return mergeLoadout(parent, def);
    }
    return resolveStandaloneLoadout(def);
  }

  /**
   * Load prompts for a role. Supports two layouts:
   *
   * 1. Single file: prompts/<role>.md (backward compatible)
   * 2. Directory:   prompts/<role>/prompt.md + additional .md files
   *
   * When a directory exists, prompt.md is the primary prompt and all
   * other .md files become additional sections. The role YAML can
   * specify an explicit file list via `prompts:` to control ordering.
   */
  private static loadPromptsForRole(
    absDir: string,
    roleName: string,
    manifest: TeamManifest,
    role?: ResolvedRole
  ): ResolvedPrompts | null {
    // Priority 1: topology node prompt path (single file, backward compat)
    if (manifest.topology.root.role === roleName && manifest.topology.root.prompt) {
      const p = path.join(absDir, manifest.topology.root.prompt);
      if (fs.existsSync(p)) {
        return { primary: fs.readFileSync(p, "utf-8"), additional: [] };
      }
    }

    if (manifest.topology.companions) {
      for (const comp of manifest.topology.companions) {
        if (comp.role === roleName && comp.prompt) {
          const p = path.join(absDir, comp.prompt);
          if (fs.existsSync(p)) {
            return { primary: fs.readFileSync(p, "utf-8"), additional: [] };
          }
        }
      }
    }

    // Priority 2: role definition prompt field (single file)
    if (role?.promptFile && !role.promptFiles) {
      const p = path.join(absDir, role.promptFile);
      if (fs.existsSync(p)) {
        return { primary: fs.readFileSync(p, "utf-8"), additional: [] };
      }
    }

    // Priority 3: prompt directory — prompts/<roleName>/
    const promptDirPath = path.join(absDir, "prompts", roleName);
    if (fs.existsSync(promptDirPath) && fs.statSync(promptDirPath).isDirectory()) {
      return TemplateLoader.loadPromptDirectory(promptDirPath, role);
    }

    // Priority 4: single file convention — prompts/<roleName>.md
    const conventionPath = path.join(absDir, "prompts", `${roleName}.md`);
    if (fs.existsSync(conventionPath)) {
      return { primary: fs.readFileSync(conventionPath, "utf-8"), additional: [] };
    }

    return null;
  }

  /**
   * Load a prompt directory into a ResolvedPrompts.
   *
   * If the role YAML declares `prompts:` (an ordered list of filenames),
   * those files are loaded in that order. The first file is primary,
   * the rest are additional sections.
   *
   * Otherwise, ROLE.md is the primary and remaining .md files are
   * loaded as additional sections. SOUL.md is always ordered first
   * among additional files so personality/values precede other materials.
   */
  private static loadPromptDirectory(
    dirPath: string,
    role?: ResolvedRole
  ): ResolvedPrompts | null {
    // Explicit ordering from role YAML
    if (role?.promptFiles && role.promptFiles.length > 0) {
      const files = role.promptFiles;
      let primary: string | null = null;
      const additional: PromptSection[] = [];

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, "utf-8");
        if (primary === null) {
          primary = content;
        } else {
          const stem = path.basename(file, path.extname(file));
          additional.push({ name: stem, content });
        }
      }

      if (primary === null) return null;
      return { primary, additional };
    }

    // Convention: ROLE.md is primary, SOUL.md is first additional,
    // remaining .md files sorted alphabetically.
    // Falls back to prompt.md / first-alphabetical for backward compat.
    const allFiles = fs.readdirSync(dirPath)
      .filter((f: string) => f.endsWith(".md"))
      .sort();

    if (allFiles.length === 0) return null;

    // Determine primary file: ROLE.md > prompt.md > first alphabetically
    let primaryFile: string;
    if (allFiles.includes("ROLE.md")) {
      primaryFile = "ROLE.md";
    } else if (allFiles.includes("prompt.md")) {
      primaryFile = "prompt.md";
    } else {
      primaryFile = allFiles[0];
    }

    const primary = fs.readFileSync(path.join(dirPath, primaryFile), "utf-8");

    // Build additional list: SOUL.md first, then the rest alphabetically
    const additional: PromptSection[] = [];
    const soulFile = allFiles.find((f: string) => f === "SOUL.md" || f === "soul.md");
    if (soulFile && soulFile !== primaryFile) {
      const content = fs.readFileSync(path.join(dirPath, soulFile), "utf-8");
      additional.push({ name: "soul", content });
    }

    for (const file of allFiles) {
      if (file === primaryFile) continue;
      if (file === soulFile) continue; // already added above
      const stem = path.basename(file, ".md");
      const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
      additional.push({ name: stem, content });
    }

    return { primary, additional };
  }
}
