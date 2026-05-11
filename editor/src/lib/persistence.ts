import { createContext, useContext } from 'react';
import type { useConfigStore } from '../stores/config-store';
import type { useCanvasStore } from '../stores/canvas-store';
import type { useUIStore } from '../stores/ui-store';

/**
 * Editor persistence layer.
 *
 * The editor is agnostic about where its state lives — localStorage works
 * for the standalone SPA, a REST adapter (OpenHive's
 * `/api/v1/teams/:id`) works for the embedded case. Consumers install
 * their adapter via `<EditorPersistenceProvider>`; callers that need to
 * bypass the context (tests, ad-hoc mounts) can pass an override directly
 * to `useAutosave(adapter)`.
 *
 * The `etag` round-trip is optional — local adapters ignore it; remote
 * adapters use it for optimistic concurrency. A 412-on-save indicates a
 * concurrent edit; the consumer chooses how to surface that.
 */

export interface EditorSavedState {
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

export interface EditorPersistenceSaveResult {
  /** Optional ETag from the storage backend; threaded into the next save. */
  etag?: string;
}

export interface EditorPersistence {
  load(): EditorSavedState | null | Promise<EditorSavedState | null>;
  save(
    state: EditorSavedState,
    opts?: { etag?: string },
  ): EditorPersistenceSaveResult | void | Promise<EditorPersistenceSaveResult | void>;
  clear?(): void | Promise<void>;
}

const LOCAL_STORAGE_KEY = 'openteams-editor-state';

/**
 * Default adapter — stores in `localStorage`. Used by the standalone SPA
 * and as the fallback when no context provider is mounted (so existing
 * tests continue to work without explicit wiring).
 */
export const defaultLocalStoragePersistence: EditorPersistence = {
  load() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as EditorSavedState;
    } catch {
      return null;
    }
  },
  save(state) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage may be full or unavailable
    }
  },
  clear() {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // nothing to do
    }
  },
};

const EditorPersistenceContext = createContext<EditorPersistence | null>(null);

export const EditorPersistenceProvider = EditorPersistenceContext.Provider;

export function useEditorPersistence(): EditorPersistence | null {
  return useContext(EditorPersistenceContext);
}
