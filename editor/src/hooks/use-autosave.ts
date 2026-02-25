import { useEffect, useRef } from 'react';
import { useConfigStore } from '../stores/config-store';
import { useCanvasStore } from '../stores/canvas-store';
import { useUIStore } from '../stores/ui-store';

const STORAGE_KEY = 'openteams-editor-state';
const DEBOUNCE_MS = 1000;

interface SavedState {
  config: {
    team: ReturnType<typeof useConfigStore.getState>['team'];
    roles: [string, ReturnType<typeof useConfigStore.getState>['roles'] extends Map<string, infer V> ? V : never][];
    channels: ReturnType<typeof useConfigStore.getState>['channels'];
    subscriptions: ReturnType<typeof useConfigStore.getState>['subscriptions'];
    emissions: ReturnType<typeof useConfigStore.getState>['emissions'];
    peerRoutes: ReturnType<typeof useConfigStore.getState>['peerRoutes'];
    spawnRules: ReturnType<typeof useConfigStore.getState>['spawnRules'];
    roleModels: ReturnType<typeof useConfigStore.getState>['roleModels'];
    topologyRoot: string;
    topologyCompanions: string[];
  };
  canvas: {
    nodes: ReturnType<typeof useCanvasStore.getState>['nodes'];
    edges: ReturnType<typeof useCanvasStore.getState>['edges'];
  };
  ui: {
    layers: ReturnType<typeof useUIStore.getState>['layers'];
  };
}

export function useAutosave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const team = useConfigStore(s => s.team);
  const roles = useConfigStore(s => s.roles);
  const channels = useConfigStore(s => s.channels);
  const subscriptions = useConfigStore(s => s.subscriptions);
  const emissions = useConfigStore(s => s.emissions);
  const peerRoutes = useConfigStore(s => s.peerRoutes);
  const spawnRules = useConfigStore(s => s.spawnRules);
  const roleModels = useConfigStore(s => s.roleModels);
  const topologyRoot = useConfigStore(s => s.topologyRoot);
  const topologyCompanions = useConfigStore(s => s.topologyCompanions);
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const layers = useUIStore(s => s.layers);

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      try {
        const state: SavedState = {
          config: {
            team,
            roles: Array.from(roles.entries()),
            channels,
            subscriptions,
            emissions,
            peerRoutes,
            spawnRules,
            roleModels,
            topologyRoot,
            topologyCompanions,
          },
          canvas: { nodes, edges },
          ui: { layers },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // localStorage may be full or unavailable
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [team, roles, channels, subscriptions, emissions, peerRoutes, spawnRules, roleModels, topologyRoot, topologyCompanions, nodes, edges, layers]);
}

export function loadSavedState(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const state: SavedState = JSON.parse(raw);
    if (!state.config?.team?.name) return false;

    const config = useConfigStore.getState();
    const canvas = useCanvasStore.getState();
    const ui = useUIStore.getState();

    const rolesMap = new Map(state.config.roles);
    config.loadFromManifest(
      state.config.team,
      rolesMap,
      state.config.channels,
      state.config.subscriptions,
      state.config.emissions,
      state.config.peerRoutes,
      state.config.spawnRules,
      state.config.roleModels,
      state.config.topologyRoot,
      state.config.topologyCompanions,
    );

    canvas.setNodes(state.canvas.nodes);
    canvas.setEdges(state.canvas.edges);

    if (state.ui?.layers) {
      for (const [key, value] of Object.entries(state.ui.layers)) {
        if (ui.layers[key as keyof typeof ui.layers] !== value) {
          ui.toggleLayer(key as keyof typeof ui.layers);
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
}
