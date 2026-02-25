import type { TeamManifest, RoleDefinition } from '@openteams/template/types';
import type { EditorRoleConfig, EditorTeamConfig } from '../stores/config-store';
import { useCanvasStore } from '../stores/canvas-store';
import { useConfigStore } from '../stores/config-store';
import { useHistoryStore } from '../stores/history-store';
import { useValidationStore } from '../stores/validation-store';
import { configToCanvas } from './serializer';

export function loadTemplate(manifest: TeamManifest, roleDefinitions: Map<string, RoleDefinition>) {
  const comm = manifest.communication || {};
  const channels = comm.channels || {};
  const subscriptions = comm.subscriptions || {};
  const emissions = comm.emissions || {};
  const peerRoutes = comm.routing?.peers || [];
  const spawnRules = manifest.topology.spawn_rules || {};

  // Build editor role configs
  const roles = new Map<string, EditorRoleConfig>();
  for (const roleName of manifest.roles) {
    const roleDef = roleDefinitions.get(roleName);
    const capabilities = Array.isArray(roleDef?.capabilities)
      ? roleDef.capabilities as string[]
      : [];

    roles.set(roleName, {
      name: roleName,
      displayName: roleDef?.display_name || roleName,
      description: roleDef?.description || '',
      extends: roleDef?.extends,
      capabilities,
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
  };

  const topologyRoot = manifest.topology.root.role;
  const topologyCompanions = (manifest.topology.companions || []).map(c => c.role);

  // Load into stores
  useConfigStore.getState().loadFromManifest(
    team, roles, channels, subscriptions, emissions, peerRoutes, spawnRules, roleModels, topologyRoot, topologyCompanions,
  );

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
