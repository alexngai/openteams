import * as yaml from 'js-yaml';
import type {
  RoleDefinition,
  TeamManifest,
  ResolvedPrompts,
  LoadoutDefinition,
} from 'openteams';
import { useConfigStore } from '../stores/config-store';
import { canvasToManifest, rolesToDefinitions } from './serializer';

export interface CompiledFile {
  path: string;
  content: string;
}

/**
 * In-memory counterpart to `compileToYaml`. Consumers that don't need
 * file-tree output (e.g. an embedded editor whose persistence backend
 * stores JSON, not YAML) can take the manifest + role definitions
 * directly without paying a YAML serialize → parse round-trip.
 *
 * The shape matches openteams's `TemplateLoader.fromObject` input so the
 * result is drop-in for bundling / hydration paths upstream — including
 * prompts and embedded loadouts so REST-authored content survives the
 * editor's autosave (stage 1 of the round-trip plug).
 */
export interface CompiledContent {
  manifest: TeamManifest;
  roles: Record<string, RoleDefinition>;
  /** Per-role prompt material (`ROLE.md` + additional sections). */
  prompts?: Record<string, ResolvedPrompts>;
  /** Embedded loadouts (the `loadouts/<name>.yaml` sidecars). */
  loadouts?: Record<string, LoadoutDefinition>;
}

const YAML_OPTIONS: yaml.DumpOptions = {
  lineWidth: -1,
  noRefs: true,
  quotingType: '"',
  forceQuotes: false,
  sortKeys: false,
};

/**
 * Build the in-memory manifest + role-definitions snapshot from the
 * current `useConfigStore` state. Pure read of editor state — no YAML
 * serialization, no DOM, no side effects. Shared by `compileToYaml`
 * (which serializes the result to file content) and embedded consumers
 * that store JSON directly.
 */
export function compileToContent(): CompiledContent {
  const config = useConfigStore.getState();

  // Use roleModels from config store (canonical source)
  const roleModels = new Map<string, string>(Object.entries(config.roleModels));

  const manifest = canvasToManifest(
    config.team,
    config.roles,
    config.channels,
    config.subscriptions,
    config.emissions,
    config.peerRoutes,
    config.spawnRules,
    config.topologyRoot,
    config.topologyCompanions,
    roleModels,
    config.team.exports,
    config.team.imports,
  );

  const roleDefs = rolesToDefinitions(config.roles);
  const roles: Record<string, RoleDefinition> = {};
  for (const [name, def] of roleDefs) {
    roles[name] = def;
  }

  // Prompts — emit ResolvedPrompts shape (`{primary, additional[]}`),
  // keyed by role name. Roles without any prompt material are omitted
  // rather than included as empty entries so the round-trip is faithful
  // to what the user actually authored.
  const prompts: Record<string, ResolvedPrompts> = {};
  for (const [roleName, role] of config.roles) {
    if (!role.promptContent && (!role.additionalPrompts || role.additionalPrompts.length === 0)) {
      continue;
    }
    prompts[roleName] = {
      primary: role.promptContent ?? '',
      additional: (role.additionalPrompts ?? []).map((p) => ({
        name: p.name,
        content: p.content,
      })),
    };
  }

  // Loadouts — verbatim passthrough from the dedicated slice. If the
  // user hasn't touched the loadouts inspector (or it isn't built yet),
  // this preserves whatever was loaded via `loadTemplate(..., loadouts)`.
  const loadouts = config.loadouts && Object.keys(config.loadouts).length > 0
    ? { ...config.loadouts }
    : undefined;

  const out: CompiledContent = { manifest, roles };
  if (Object.keys(prompts).length > 0) out.prompts = prompts;
  if (loadouts) out.loadouts = loadouts;
  return out;
}

export function compileToYaml(): CompiledFile[] {
  const { manifest } = compileToContent();
  const config = useConfigStore.getState();

  const files: CompiledFile[] = [];

  // team.yaml
  files.push({
    path: 'team.yaml',
    content: yaml.dump(manifest, YAML_OPTIONS),
  });

  // roles/*.yaml
  const roleDefs = rolesToDefinitions(config.roles);
  for (const [name, def] of roleDefs) {
    files.push({
      path: `roles/${name}.yaml`,
      content: yaml.dump(def, YAML_OPTIONS),
    });
  }

  // prompts/*
  for (const [name, role] of config.roles) {
    if (role.promptContent) {
      files.push({
        path: `prompts/${name}/ROLE.md`,
        content: role.promptContent,
      });
    }
    if (role.additionalPrompts) {
      for (const p of role.additionalPrompts) {
        if (p.content) {
          files.push({
            path: `prompts/${name}/${p.name}`,
            content: p.content,
          });
        }
      }
    }
  }

  return files;
}
