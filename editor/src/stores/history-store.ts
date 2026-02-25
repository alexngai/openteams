import { create } from 'zustand';
import { useCanvasStore } from './canvas-store';
import { useConfigStore } from './config-store';
import type { EditorNode, EditorEdge } from '../types/editor';
import type { EditorRoleConfig, EditorTeamConfig } from './config-store';
import type {
  ChannelDefinition,
  SubscriptionEntry,
  PeerRoute,
} from '@openteams/template/types';

interface Snapshot {
  canvas: {
    nodes: EditorNode[];
    edges: EditorEdge[];
  };
  config: {
    team: EditorTeamConfig;
    roles: Map<string, EditorRoleConfig>;
    channels: Record<string, ChannelDefinition>;
    subscriptions: Record<string, SubscriptionEntry[]>;
    emissions: Record<string, string[]>;
    peerRoutes: PeerRoute[];
    spawnRules: Record<string, string[]>;
    roleModels: Record<string, string>;
    topologyRoot: string;
    topologyCompanions: string[];
  };
}

const MAX_HISTORY = 50;

function deepClone<T>(obj: T): T {
  if (obj instanceof Map) {
    const result = new Map();
    for (const [key, val] of obj) {
      result.set(key, deepClone(val));
    }
    return result as T;
  }
  return structuredClone(obj);
}

function captureSnapshot(): Snapshot {
  const canvas = useCanvasStore.getState();
  const config = useConfigStore.getState();
  return {
    canvas: {
      nodes: deepClone(canvas.nodes),
      edges: deepClone(canvas.edges),
    },
    config: {
      team: deepClone(config.team),
      roles: deepClone(config.roles),
      channels: deepClone(config.channels),
      subscriptions: deepClone(config.subscriptions),
      emissions: deepClone(config.emissions),
      peerRoutes: deepClone(config.peerRoutes),
      spawnRules: deepClone(config.spawnRules),
      roleModels: deepClone(config.roleModels),
      topologyRoot: config.topologyRoot,
      topologyCompanions: [...config.topologyCompanions],
    },
  };
}

function restoreSnapshot(snapshot: Snapshot) {
  const canvasState = deepClone(snapshot.canvas);
  const configState = deepClone(snapshot.config);

  useCanvasStore.getState().setNodes(canvasState.nodes);
  useCanvasStore.getState().setEdges(canvasState.edges);
  useConfigStore.getState().loadFromManifest(
    configState.team,
    configState.roles,
    configState.channels,
    configState.subscriptions,
    configState.emissions,
    configState.peerRoutes,
    configState.spawnRules,
    configState.roleModels,
    configState.topologyRoot,
    configState.topologyCompanions,
  );
}

interface HistoryStore {
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  undoStack: [],
  redoStack: [],

  pushSnapshot: () => {
    const snapshot = captureSnapshot();
    const stack = [...get().undoStack, snapshot];
    if (stack.length > MAX_HISTORY) stack.shift();
    set({ undoStack: stack, redoStack: [] });
  },

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;

    const currentSnapshot = captureSnapshot();
    const previous = undoStack[undoStack.length - 1];
    const newUndo = undoStack.slice(0, -1);

    restoreSnapshot(previous);
    set({
      undoStack: newUndo,
      redoStack: [...get().redoStack, currentSnapshot],
    });
  },

  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return;

    const currentSnapshot = captureSnapshot();
    const next = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);

    restoreSnapshot(next);
    set({
      undoStack: [...get().undoStack, currentSnapshot],
      redoStack: newRedo,
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  clear: () => set({ undoStack: [], redoStack: [] }),
}));
