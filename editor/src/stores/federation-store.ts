import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type { FederationBridge, FederationManifest, PlacementConfig } from '@openteams/template/types';
import type { TeamNodeData, BridgeEdgeData } from '../types/editor';

export interface FederationTeamEntry {
  teamKey: string;
  teamName: string;
  description: string;
  templatePath: string;
  roleCount: number;
  channelCount: number;
  exportCount: number;
  importCount: number;
  exports: { signal: string; description?: string }[];
  imports: { channel: string; signals: string[]; description?: string }[];
  placement?: PlacementConfig;
}

interface FederationStore {
  // Federation metadata
  name: string;
  version: number;
  enforcement: 'strict' | 'permissive' | 'audit';

  // Teams in the federation
  teams: Map<string, FederationTeamEntry>;

  // Bridges
  bridges: FederationBridge[];

  // Canvas state for federation view
  nodes: Node<TeamNodeData>[];
  edges: Edge<BridgeEdgeData>[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // Actions
  setFederationMeta: (updates: Partial<{ name: string; version: number; enforcement: 'strict' | 'permissive' | 'audit' }>) => void;
  addTeam: (entry: FederationTeamEntry) => void;
  removeTeam: (teamKey: string) => void;
  updateTeam: (teamKey: string, updates: Partial<FederationTeamEntry>) => void;
  addBridge: (bridge: FederationBridge) => void;
  removeBridge: (index: number) => void;
  setNodes: (nodes: Node<TeamNodeData>[]) => void;
  setEdges: (edges: Edge<BridgeEdgeData>[]) => void;
  setSelection: (nodeId: string | null, edgeId: string | null) => void;
  rebuildCanvas: () => void;
  clear: () => void;
  loadFromManifest: (manifest: FederationManifest, teamDetails: Map<string, FederationTeamEntry>) => void;
  toManifest: () => FederationManifest;
}

export const useFederationStore = create<FederationStore>((set, get) => ({
  name: 'new-federation',
  version: 1,
  enforcement: 'permissive',
  teams: new Map(),
  bridges: [],
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,

  setFederationMeta: (updates) => {
    set({ ...updates });
  },

  addTeam: (entry) => {
    const teams = new Map(get().teams);
    teams.set(entry.teamKey, entry);
    set({ teams });
    get().rebuildCanvas();
  },

  removeTeam: (teamKey) => {
    const teams = new Map(get().teams);
    teams.delete(teamKey);
    // Remove bridges referencing this team
    const bridges = get().bridges.filter(
      b => b.from.team !== teamKey && b.to.team !== teamKey
    );
    set({ teams, bridges });
    get().rebuildCanvas();
  },

  updateTeam: (teamKey, updates) => {
    const teams = new Map(get().teams);
    const existing = teams.get(teamKey);
    if (existing) {
      teams.set(teamKey, { ...existing, ...updates });
      set({ teams });
      get().rebuildCanvas();
    }
  },

  addBridge: (bridge) => {
    set({ bridges: [...get().bridges, bridge] });
    get().rebuildCanvas();
  },

  removeBridge: (index) => {
    set({ bridges: get().bridges.filter((_, i) => i !== index) });
    get().rebuildCanvas();
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  setSelection: (nodeId, edgeId) => {
    set({ selectedNodeId: nodeId, selectedEdgeId: edgeId });
  },

  rebuildCanvas: () => {
    const { teams, bridges } = get();
    const nodes: Node<TeamNodeData>[] = [];
    const edges: Edge<BridgeEdgeData>[] = [];

    // Create team nodes in a grid layout
    let x = 100;
    let y = 100;
    const spacing = 320;
    const cols = Math.max(2, Math.ceil(Math.sqrt(teams.size)));

    let i = 0;
    for (const [key, entry] of teams) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes.push({
        id: `team-${key}`,
        type: 'team',
        position: { x: x + col * spacing, y: y + row * 280 },
        data: {
          kind: 'team',
          teamKey: key,
          teamName: entry.teamName,
          description: entry.description,
          roleCount: entry.roleCount,
          channelCount: entry.channelCount,
          exportCount: entry.exportCount,
          importCount: entry.importCount,
          templatePath: entry.templatePath,
          errors: [],
          warnings: [],
        },
      });
      i++;
    }

    // Create bridge edges
    bridges.forEach((bridge, idx) => {
      edges.push({
        id: `bridge-${idx}`,
        source: `team-${bridge.from.team}`,
        target: `team-${bridge.to.team}`,
        type: 'bridge',
        data: {
          kind: 'bridge',
          fromTeam: bridge.from.team,
          fromSignal: bridge.from.signal,
          toTeam: bridge.to.team,
          toChannel: bridge.to.channel,
          toSignal: bridge.to.signal,
        },
      });
    });

    set({ nodes, edges });
  },

  clear: () => {
    set({
      name: 'new-federation',
      version: 1,
      enforcement: 'permissive',
      teams: new Map(),
      bridges: [],
      nodes: [],
      edges: [],
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  loadFromManifest: (manifest, teamDetails) => {
    set({
      name: manifest.name,
      version: manifest.version,
      enforcement: manifest.enforcement || 'permissive',
      teams: new Map(teamDetails),
      bridges: manifest.bridges || [],
    });
    get().rebuildCanvas();
  },

  toManifest: () => {
    const { name, version, enforcement, teams, bridges } = get();
    const manifestTeams: Record<string, { template: string; placement?: PlacementConfig }> = {};
    for (const [key, entry] of teams) {
      manifestTeams[key] = {
        template: entry.templatePath,
        ...(entry.placement ? { placement: entry.placement } : {}),
      };
    }
    return {
      name,
      version,
      teams: manifestTeams,
      bridges: bridges.length > 0 ? bridges : undefined,
      enforcement,
    };
  },
}));
