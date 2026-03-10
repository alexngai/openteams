import type { Node, Edge } from '@xyflow/react';

// ── Node Data ──────────────────────────────────────────
// Index signatures are required by React Flow v12's Node<T> constraint.

export interface RoleNodeData extends Record<string, unknown> {
  kind: 'role';
  roleName: string;
  displayName: string;
  description: string;
  topologyPosition: 'root' | 'companion' | 'spawned';
  model?: string;
  capabilities: string[];
  extends?: string;
  emits: string[];
  subscribesTo: SubscriptionSummary[];
  peerRoutesOut: number;
  peerRoutesIn: number;
  canSpawn: string[];
  errors: string[];
  warnings: string[];
}

export interface SubscriptionSummary {
  channel: string;
  signals: string[] | 'all';
}

export interface ChannelNodeData extends Record<string, unknown> {
  kind: 'channel';
  channelName: string;
  description: string;
  signals: string[];
  emitterCount: number;
  subscriberCount: number;
}

// ── Edge Data ──────────────────────────────────────────

export interface PeerRouteEdgeData extends Record<string, unknown> {
  kind: 'peer-route';
  signals: string[];
  via: 'direct' | 'topic' | 'scope';
}

export interface SignalFlowEdgeData extends Record<string, unknown> {
  kind: 'signal-flow';
  direction: 'emission' | 'subscription';
  channel: string;
  signals: string[];
}

export interface SpawnEdgeData extends Record<string, unknown> {
  kind: 'spawn';
}

// ── Unions ─────────────────────────────────────────────

export type RoleNode = Node<RoleNodeData, 'role'>;
export type ChannelNode = Node<ChannelNodeData, 'channel'>;

export type EditorNode = RoleNode | ChannelNode;
export type EditorEdge =
  | Edge<PeerRouteEdgeData>
  | Edge<SignalFlowEdgeData>
  | Edge<SpawnEdgeData>;

// ── Federation Node/Edge Data ─────────────────────────

export interface TeamNodeData extends Record<string, unknown> {
  kind: 'team';
  teamKey: string;
  teamName: string;
  description: string;
  roleCount: number;
  channelCount: number;
  exportCount: number;
  importCount: number;
  templatePath: string;
  errors: string[];
  warnings: string[];
}

export interface BridgeEdgeData extends Record<string, unknown> {
  kind: 'bridge';
  fromTeam: string;
  fromSignal: string;
  toTeam: string;
  toChannel: string;
  toSignal: string;
}

export type TeamNode = Node<TeamNodeData, 'team'>;

export type FederationNode = TeamNode;
export type FederationEdge = Edge<BridgeEdgeData>;

// ── Canvas State ───────────────────────────────────────

export interface CanvasState {
  nodes: EditorNode[];
  edges: EditorEdge[];
  viewport: { x: number; y: number; zoom: number };
}
