import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type {
  TeamManifest,
  RoleDefinition,
  ResolvedTemplate,
  ResolvedRole,
  CapabilityComposition,
} from "./types";

export class TemplateLoader {
  /**
   * Load a team template from a directory.
   * Expects: team.yaml, optional roles/*.yaml, optional prompts/*.md
   */
  static load(templateDir: string): ResolvedTemplate {
    const absDir = path.resolve(templateDir);

    if (!fs.existsSync(absDir)) {
      throw new Error(`Template directory not found: ${absDir}`);
    }

    const manifestPath = path.join(absDir, "team.yaml");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`team.yaml not found in ${absDir}`);
    }

    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    const manifest = yaml.load(manifestContent) as TeamManifest;

    TemplateLoader.validateManifest(manifest);

    const roles = new Map<string, ResolvedRole>();
    const prompts = new Map<string, string>();

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

    // Resolve role inheritance chains
    TemplateLoader.resolveInheritance(roles);

    // Load prompts
    for (const roleName of manifest.roles) {
      const promptContent = TemplateLoader.loadPromptForRole(
        absDir,
        roleName,
        manifest,
        roles.get(roleName)
      );
      if (promptContent) {
        prompts.set(roleName, promptContent);
      }
    }

    return {
      manifest,
      roles,
      prompts,
      sourcePath: absDir,
    };
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
      sourcePath: "",
    };
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
        for (const target of targets) {
          if (!declaredRoles.has(target)) {
            throw new Error(
              `spawn_rules "${from}" references unknown role "${target}"`
            );
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
    }
  }

  /**
   * Resolve role inheritance chains. For each role with `extends` pointing
   * to another role in the map, merge parent capabilities with the child's
   * add/remove composition. Detects circular inheritance.
   */
  private static resolveInheritance(roles: Map<string, ResolvedRole>): void {
    // Build dependency map: child -> parent (only for parents that exist in the map)
    const extendsMap = new Map<string, string>();
    for (const [name, role] of roles) {
      if (role.extends && roles.has(role.extends)) {
        extendsMap.set(name, role.extends);
      }
    }

    if (extendsMap.size === 0) return;

    // Detect cycles by following chains
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

    function resolve(name: string): void {
      if (resolved.has(name)) return;

      const parent = extendsMap.get(name);
      if (parent) {
        resolve(parent);
      }

      const role = roles.get(name)!;
      if (parent) {
        const parentRole = roles.get(parent)!;
        const raw = role.raw;

        if (raw.capabilities && !Array.isArray(raw.capabilities)) {
          // CapabilityComposition — merge with parent
          const comp = raw.capabilities as CapabilityComposition;
          const parentCaps = [...parentRole.capabilities];
          const toAdd = comp.add ?? [];
          const toRemove = new Set(comp.remove ?? []);

          // Start with parent caps, add child additions, remove exclusions
          const merged = [...new Set([...parentCaps, ...toAdd])];
          role.capabilities = merged.filter((c) => !toRemove.has(c));
        }
        // If capabilities is a plain array, it's an explicit override — keep as-is
      }

      resolved.add(name);
    }

    for (const name of extendsMap.keys()) {
      resolve(name);
    }
  }

  private static resolveRole(def: RoleDefinition): ResolvedRole {
    let capabilities: string[] = [];

    if (def.capabilities) {
      if (Array.isArray(def.capabilities)) {
        capabilities = def.capabilities;
      } else {
        // CapabilityComposition — resolve against parent later if extends is used.
        // For now, just collect the add list.
        const comp = def.capabilities as CapabilityComposition;
        capabilities = comp.add ?? [];
        // remove is applied when composing with parent; tracked in raw for later
      }
    }

    return {
      name: def.name,
      extends: def.extends,
      displayName: def.display_name ?? def.name,
      description: def.description ?? `Role: ${def.name}`,
      capabilities,
      promptFile: def.prompt,
      raw: def,
    };
  }

  private static loadPromptForRole(
    absDir: string,
    roleName: string,
    manifest: TeamManifest,
    role?: ResolvedRole
  ): string | null {
    // Priority 1: topology node prompt path
    if (manifest.topology.root.role === roleName && manifest.topology.root.prompt) {
      const p = path.join(absDir, manifest.topology.root.prompt);
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    }

    if (manifest.topology.companions) {
      for (const comp of manifest.topology.companions) {
        if (comp.role === roleName && comp.prompt) {
          const p = path.join(absDir, comp.prompt);
          if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
        }
      }
    }

    // Priority 2: role definition prompt field
    if (role?.promptFile) {
      const p = path.join(absDir, role.promptFile);
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    }

    // Priority 3: convention — prompts/<roleName>.md
    const conventionPath = path.join(absDir, "prompts", `${roleName}.md`);
    if (fs.existsSync(conventionPath)) {
      return fs.readFileSync(conventionPath, "utf-8");
    }

    return null;
  }
}
