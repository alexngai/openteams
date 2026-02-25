import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { EditorNode, EditorEdge } from '../types/editor';

interface CanvasStore {
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  setSelection: (nodeId: string | null, edgeId: string | null) => void;
  setNodes: (nodes: EditorNode[]) => void;
  setEdges: (edges: EditorEdge[]) => void;
  addNode: (node: EditorNode) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edge: EditorEdge) => void;
  removeEdge: (edgeId: string) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  clear: () => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,

  onNodesChange: (changes: any) => {
    set({ nodes: applyNodeChanges(changes, get().nodes as any) as any });
  },

  onEdgesChange: (changes: any) => {
    set({ edges: applyEdgeChanges(changes, get().edges as any) as any });
  },

  setSelection: (nodeId, edgeId) => {
    set({ selectedNodeId: nodeId, selectedEdgeId: edgeId });
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
  },

  removeNode: (nodeId) => {
    const { nodes, edges } = get();
    set({
      nodes: nodes.filter(n => n.id !== nodeId),
      edges: edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
  },

  addEdge: (edge) => {
    set({ edges: [...get().edges, edge] });
  },

  removeEdge: (edgeId) => {
    set({
      edges: get().edges.filter(e => e.id !== edgeId),
      selectedEdgeId: get().selectedEdgeId === edgeId ? null : get().selectedEdgeId,
    });
  },

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ) as EditorNode[],
    });
  },

  clear: () => {
    set({ nodes: [], edges: [], selectedNodeId: null, selectedEdgeId: null });
  },
}));
