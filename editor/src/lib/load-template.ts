import type {
  TeamManifest,
  RoleDefinition,
  ResolvedPrompts,
  LoadoutDefinition,
} from 'openteams';
import type { EditorRoleConfig, EditorTeamConfig } from '../stores/config-store';
import { useCanvasStore } from '../stores/canvas-store';
import { useConfigStore } from '../stores/config-store';
import { useHistoryStore } from '../stores/history-store';
import { useValidationStore } from '../stores/validation-store';
import { configToCanvas } from './serializer';

export function loadEmpty() {
  const team: EditorTeamConfig = {
    name: 'untitled',
    description: '',
    version: 1,
    enforcement: 'permissive',
    extensions: {},
    exports: [],
    imports: [],
  };

  useConfigStore.getState().loadFromManifest(
    team, new Map(), {}, {}, {}, [], {}, {}, '', [],
  );
  useCanvasStore.getState().setNodes([]);
  useCanvasStore.getState().setEdges([]);
  useHistoryStore.getState().clear();
  useHistoryStore.getState().pushSnapshot();
  useValidationStore.getState().clear();
}

/**
 * Hydrate the editor stores from a parsed openteams template.
 *
 * - `manifest` and `roleDefinitions` are the always-required pair (file
 *   layout: `team.yaml` + `roles/*.yaml`).
 * - `prompts` is the optional per-role prompt material (file layout:
 *   `prompts/<role>/ROLE.md` + additional `.md` sections). Without it,
 *   the editor opens a team with the prompt textareas empty even when
 *   the row's `metadata.content.prompts` is populated — the original
 *   data-loss bug we're fixing in stage 1.
 * - `loadouts` is the optional embedded-loadout map (file layout:
 *   `loadouts/<name>.yaml`). Round-tripped through a verbatim
 *   passthrough slice on the store so they survive autosave even
 *   before the loadout-authoring UI lands.
 */
export function loadTemplate(
  manifest: TeamManifest,
  roleDefinitions: Map<string, RoleDefinition>,
  prompts?: Record<string, ResolvedPrompts>,
  loadouts?: Record<string, LoadoutDefinition>,
) {
  const comm = manifest.communication || {};
  const channels = comm.channels || {};
  const subscriptions = comm.subscriptions || {};
  const emissions = comm.emissions || {};
  const peerRoutes = comm.routing?.peers || [];
  const rawSpawnRules = manifest.topology.spawn_rules || {};
  const spawnRules: Record<string, string[]> = {};
  for (const [role, entries] of Object.entries(rawSpawnRules)) {
    spawnRules[role] = entries.map(e => typeof e === 'string' ? e : e.role);
  }

  // Build editor role configs
  const roles = new Map<string, EditorRoleConfig>();

  // Build a placement lookup from topology nodes
  const placementByRole: Record<string, import('openteams').PlacementConfig> = {};
  if (manifest.topology.root.config?.placement) {
    placementByRole[manifest.topology.root.role] = manifest.topology.root.config.placement;
  }
  for (const companion of manifest.topology.companions || []) {
    if (companion.config?.placement) {
      placementByRole[companion.role] = companion.config.placement;
    }
  }

  for (const roleName of manifest.roles) {
    const roleDef = roleDefinitions.get(roleName);
    const capabilities = Array.isArray(roleDef?.capabilities)
      ? roleDef.capabilities as string[]
      : [];

    // Hydrate prompts when present — the input shape mirrors openteams's
    // `ResolvedPrompts` (`primary` string + `additional: PromptSection[]`).
    // The editor's role config keeps them as `promptContent` (primary)
    // and `additionalPrompts` (already `{name, content}[]`), so it's a
    // direct mapping. Stage 1 of the round-trip plug.
    const rolePrompts = prompts?.[roleName];
    const promptContent = rolePrompts?.primary || undefined;
    const additionalPrompts = rolePrompts?.additional
      ? rolePrompts.additional.map((p) => ({ name: p.name, content: p.content }))
      : undefined;

    // Loadout binding — accept slug form for the editor's UI. Inline
    // LoadoutDefinition bindings round-trip via the embedded-loadouts
    // slice (we hoist them out of the role into a synthesized
    // `__inline:<role>` loadout) but inline-bind authoring stays out
    // of scope for v1.
    const loadoutBinding =
      typeof roleDef?.loadout === 'string' ? (roleDef.loadout as string) : undefined;

    roles.set(roleName, {
      name: roleName,
      displayName: roleDef?.display_name || roleName,
      description: roleDef?.description || '',
      extends: roleDef?.extends,
      capabilities,
      placement: placementByRole[roleName],
      promptContent,
      additionalPrompts,
      loadout: loadoutBinding,
    });
  }

  // Extract model assignments from topology
  const roleModels: Record<string, string> = {};
  if (manifest.topology.root.config?.model) {
    roleModels[manifest.topology.root.role] = manifest.topology.root.config.model;
  }
  for (const companion of manifest.topology.companions || []) {
    if (companion.config?.model) {
      roleModels[companion.role] = companion.config.model;
    }
  }

  // Build team config
  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!['name', 'description', 'version', 'roles', 'topology', 'communication'].includes(key)) {
      extensions[key] = value;
    }
  }

  const team: EditorTeamConfig = {
    name: manifest.name,
    description: manifest.description || '',
    version: 1,
    enforcement: comm.enforcement || 'permissive',
    extensions,
    exports: comm.exports || [],
    imports: comm.imports || [],
  };

  const topologyRoot = manifest.topology.root.role;
  const topologyCompanions = (manifest.topology.companions || []).map(c => c.role);

  // Load into stores
  useConfigStore.getState().loadFromManifest(
    team, roles, channels, subscriptions, emissions, peerRoutes, spawnRules, roleModels, topologyRoot, topologyCompanions,
  );

  // Embedded loadouts: verbatim passthrough into the dedicated slice.
  // `setLoadouts` runs *after* `loadFromManifest` because the latter
  // doesn't touch loadouts (it predates this slice), and we want a
  // clean initial state for history snapshots below.
  useConfigStore.getState().setLoadouts(loadouts ?? {});

  // Build canvas from config
  const canvasState = configToCanvas(manifest, roleDefinitions);
  useCanvasStore.getState().setNodes(canvasState.nodes);
  useCanvasStore.getState().setEdges(canvasState.edges);

  // Reset history
  useHistoryStore.getState().clear();
  useHistoryStore.getState().pushSnapshot();

  // Clear validation
  useValidationStore.getState().clear();
}
