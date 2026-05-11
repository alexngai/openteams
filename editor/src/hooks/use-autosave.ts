import { useEffect, useRef } from 'react';
import { useConfigStore } from '../stores/config-store';
import { useCanvasStore } from '../stores/canvas-store';
import { useUIStore } from '../stores/ui-store';
import { useEditorPersistence, defaultLocalStoragePersistence } from '../lib/persistence';
import type { EditorPersistence, EditorSavedState } from '../lib/persistence';

const DEBOUNCE_MS = 1000;

// Re-export the shape for callers that want to construct their own snapshots.
export type SavedState = EditorSavedState;

/**
 * Debounced autosave that persists the editor's full state through the
 * currently-installed `EditorPersistence` adapter. The default adapter
 * writes to localStorage (matches pre-refactor behaviour); consumers like
 * OpenHive plug in a REST adapter via `<EditorPersistenceProvider>` to
 * point the same calls at `/api/v1/teams/:id`.
 *
 * @param override - optional explicit adapter; bypasses the context for
 *   tests or one-off mounts.
 */
export function useAutosave(override?: EditorPersistence): void {
  const ctxAdapter = useEditorPersistence();
  const adapter = override ?? ctxAdapter ?? defaultLocalStoragePersistence;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Retain the last save's ETag so we can offer optimistic concurrency on
  // remote persistence backends. Local persistence ignores it.
  const etagRef = useRef<string | undefined>(undefined);

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
      const state: EditorSavedState = {
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
      void Promise.resolve(adapter.save(state, { etag: etagRef.current }))
        .then((res) => {
          if (res && res.etag) etagRef.current = res.etag;
        })
        .catch(() => {
          // Persistence backends are responsible for surfacing their own
          // errors (e.g. via toast); we swallow here so a transient failure
          // doesn't unmount the editor.
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [adapter, team, roles, channels, subscriptions, emissions, peerRoutes, spawnRules, roleModels, topologyRoot, topologyCompanions, nodes, edges, layers]);
}

/**
 * Restore editor state from the currently-installed persistence adapter.
 * Synchronous for the localStorage default; async-aware for remote
 * adapters (returns a promise that callers can await).
 */
export async function loadSavedState(
  adapter: EditorPersistence = defaultLocalStoragePersistence,
): Promise<boolean> {
  try {
    const state = await Promise.resolve(adapter.load());
    if (!state || !state.config?.team?.name) return false;

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

export function clearSavedState(adapter: EditorPersistence = defaultLocalStoragePersistence): void {
  void Promise.resolve(adapter.clear?.()).catch(() => undefined);
}
