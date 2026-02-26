import type {
  TeamManifest,
  CommunicationConfig,
  RoleDefinition,
  SubscriptionEntry,
  PeerRoute,
  ChannelDefinition,
} from '@openteams/template/types';
import type {
  EditorNode,
  EditorEdge,
  RoleNodeData,
  ChannelNodeData,
  PeerRouteEdgeData,
  SignalFlowEdgeData,
  SpawnEdgeData,
  CanvasState,
} from '../types/editor';
import type { EditorRoleConfig, EditorTeamConfig } from '../stores/config-store';
import { computeLayout } from './auto-layout';

// ── Helpers ────────────────────────────────────────────

function findChannelForSignal(
  channels: Record<string, ChannelDefinition>,
  signal: string,
): string | undefined {
  for (const [name, ch] of Object.entries(channels)) {
    if (ch.signals.includes(signal)) return name;
  }
  return undefined;
}

function getTopologyPosition(
  roleName: string,
  manifest: TeamManifest,
): 'root' | 'companion' | 'spawned' {
  if (manifest.topology.root.role === roleName) return 'root';
  if (manifest.topology.companions?.some(c => c.role === roleName)) return 'companion';
  return 'spawned';
}

function getModelForRole(roleName: string, manifest: TeamManifest): string | undefined {
  if (manifest.topology.root.role === roleName) {
    return manifest.topology.root.config?.model;
  }
  const companion = manifest.topology.companions?.find(c => c.role === roleName);
  return companion?.config?.model;
}

// ── Path offset computation ───────────────────────────

const EDGE_SPREAD_X = 8; // horizontal px between sibling edge paths
const EDGE_SPREAD_Y = 6; // vertical px between sibling edge paths

/**
 * For edges sharing the same source or target node, assign small X and Y
 * offsets so their SmoothStep paths don't overlap.  X offsets fan sibling
 * edges at the connection point; Y offsets separate the horizontal segments
 * that would otherwise run along the same line.
 */
function assignPathOffsets(edges: EditorEdge[]): void {
  // Count how many edges leave/enter each node
  const sourceCount = new Map<string, number>();
  const targetCount = new Map<string, number>();
  for (const e of edges) {
    sourceCount.set(e.source, (sourceCount.get(e.source) ?? 0) + 1);
    targetCount.set(e.target, (targetCount.get(e.target) ?? 0) + 1);
  }

  // Assign per-edge index within each group
  const sourceIdx = new Map<string, number>();
  const targetIdx = new Map<string, number>();

  for (const e of edges) {
    const srcTotal = sourceCount.get(e.source) ?? 1;
    const si = sourceIdx.get(e.source) ?? 0;
    sourceIdx.set(e.source, si + 1);

    const tgtTotal = targetCount.get(e.target) ?? 1;
    const ti = targetIdx.get(e.target) ?? 0;
    targetIdx.set(e.target, ti + 1);

    const srcOffsetX = (si - (srcTotal - 1) / 2) * EDGE_SPREAD_X;
    const tgtOffsetX = (ti - (tgtTotal - 1) / 2) * EDGE_SPREAD_X;
    const srcOffsetY = (si - (srcTotal - 1) / 2) * EDGE_SPREAD_Y;
    const tgtOffsetY = (ti - (tgtTotal - 1) / 2) * EDGE_SPREAD_Y;

    if (e.data) {
      (e.data as Record<string, unknown>).pathOffset = {
        sourceX: srcOffsetX,
        sourceY: srcOffsetY,
        targetX: tgtOffsetX,
        targetY: tgtOffsetY,
      };
    }
  }
}

// ── Config → Canvas ────────────────────────────────────

export function configToCanvas(
  manifest: TeamManifest,
  roleDefinitions: Map<string, RoleDefinition>,
): CanvasState {
  const comm = manifest.communication || {};
  const channels = comm.channels || {};
  const subscriptions = comm.subscriptions || {};
  const emissions = comm.emissions || {};
  const peerRoutes = comm.routing?.peers || [];
  const spawnRules = manifest.topology.spawn_rules || {};

  const nodes: EditorNode[] = [];
  const edges: EditorEdge[] = [];

  // 1. Create RoleNodes
  for (const roleName of manifest.roles) {
    const roleDef = roleDefinitions.get(roleName);
    const position = getTopologyPosition(roleName, manifest);
    const model = getModelForRole(roleName, manifest);

    const roleEmissions = emissions[roleName] || [];
    const roleSubs = (subscriptions[roleName] || []).map(sub => ({
      channel: sub.channel,
      signals: sub.signals || ('all' as const),
    }));

    const peerOut = peerRoutes.filter(r => r.from === roleName).length;
    const peerIn = peerRoutes.filter(r => r.to === roleName).length;
    const rawSpawn = spawnRules[roleName] || [];
    const canSpawn = rawSpawn.map(e => typeof e === 'string' ? e : e.role);

    const capabilities = Array.isArray(roleDef?.capabilities)
      ? roleDef.capabilities as string[]
      : [];

    const data: RoleNodeData = {
      kind: 'role',
      roleName,
      displayName: roleDef?.display_name || roleName,
      description: roleDef?.description || '',
      topologyPosition: position,
      model,
      capabilities,
      extends: roleDef?.extends,
      emits: roleEmissions,
      subscribesTo: roleSubs,
      peerRoutesOut: peerOut,
      peerRoutesIn: peerIn,
      canSpawn,
      errors: [],
      warnings: [],
    };

    nodes.push({
      id: `role-${roleName}`,
      type: 'role',
      position: { x: 0, y: 0 },
      data,
    });
  }

  // 2. Create ChannelNodes
  for (const [channelName, channelDef] of Object.entries(channels)) {
    // Count emitters: roles that emit signals belonging to this channel
    const emitterRoles = new Set<string>();
    for (const [role, roleSignals] of Object.entries(emissions)) {
      for (const sig of roleSignals) {
        if (channelDef.signals.includes(sig)) {
          emitterRoles.add(role);
        }
      }
    }

    // Count subscribers
    const subscriberRoles = new Set<string>();
    for (const [role, roleSubs] of Object.entries(subscriptions)) {
      for (const sub of roleSubs) {
        if (sub.channel === channelName) {
          subscriberRoles.add(role);
        }
      }
    }

    const data: ChannelNodeData = {
      kind: 'channel',
      channelName,
      description: channelDef.description || '',
      signals: channelDef.signals,
      emitterCount: emitterRoles.size,
      subscriberCount: subscriberRoles.size,
    };

    nodes.push({
      id: `channel-${channelName}`,
      type: 'channel',
      position: { x: 0, y: 0 },
      data,
    });
  }

  // 3. Create PeerRouteEdges
  peerRoutes.forEach((route, index) => {
    const edgeData: PeerRouteEdgeData = {
      kind: 'peer-route',
      signals: route.signals || [],
      via: route.via,
    };
    edges.push({
      id: `peer-${route.from}-${route.to}-${index}`,
      source: `role-${route.from}`,
      target: `role-${route.to}`,
      type: 'peer-route',
      data: edgeData,
    });
  });

  // 4. Create SignalFlowEdges (emissions: role → channel)
  for (const [role, roleSignals] of Object.entries(emissions)) {
    // Group by channel
    const channelSignals = new Map<string, string[]>();
    for (const sig of roleSignals) {
      const ch = findChannelForSignal(channels, sig);
      if (ch) {
        const existing = channelSignals.get(ch) || [];
        existing.push(sig);
        channelSignals.set(ch, existing);
      }
    }

    for (const [ch, sigs] of channelSignals) {
      const edgeData: SignalFlowEdgeData = {
        kind: 'signal-flow',
        direction: 'emission',
        channel: ch,
        signals: sigs,
      };
      edges.push({
        id: `emit-${role}-${ch}`,
        source: `role-${role}`,
        target: `channel-${ch}`,
        type: 'signal-flow',
        data: edgeData,
      });
    }
  }

  // 5. Create SignalFlowEdges (subscriptions: channel → role)
  for (const [role, roleSubs] of Object.entries(subscriptions)) {
    for (const sub of roleSubs) {
      const edgeData: SignalFlowEdgeData = {
        kind: 'signal-flow',
        direction: 'subscription',
        channel: sub.channel,
        signals: sub.signals || [],
      };
      edges.push({
        id: `sub-${sub.channel}-${role}`,
        source: `channel-${sub.channel}`,
        target: `role-${role}`,
        type: 'signal-flow',
        data: edgeData,
      });
    }
  }

  // 6. Create SpawnEdges
  for (const [fromRole, targets] of Object.entries(spawnRules)) {
    for (const toRole of targets) {
      const edgeData: SpawnEdgeData = { kind: 'spawn' };
      edges.push({
        id: `spawn-${fromRole}-${toRole}`,
        source: `role-${fromRole}`,
        target: `role-${toRole}`,
        type: 'spawn',
        data: edgeData,
      });
    }
  }

  // 7. Compute path offsets so sibling edges don't overlap
  assignPathOffsets(edges);

  // 8. Auto-layout
  const layoutNodes = computeLayout(nodes, edges);

  return {
    nodes: layoutNodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

// ── Canvas → Config ────────────────────────────────────

export function canvasToManifest(
  team: EditorTeamConfig,
  roles: Map<string, EditorRoleConfig>,
  channels: Record<string, ChannelDefinition>,
  subscriptions: Record<string, SubscriptionEntry[]>,
  emissions: Record<string, string[]>,
  peerRoutes: PeerRoute[],
  spawnRules: Record<string, string[]>,
  topologyRoot: string,
  topologyCompanions: string[],
  roleModels: Map<string, string>,
): TeamManifest {
  const roleNames = Array.from(roles.keys());

  const manifest: TeamManifest = {
    name: team.name,
    description: team.description || undefined,
    version: team.version,
    roles: roleNames,
    topology: {
      root: {
        role: topologyRoot,
        ...(roleModels.get(topologyRoot)
          ? { config: { model: roleModels.get(topologyRoot) } }
          : {}),
      },
      ...(topologyCompanions.length > 0
        ? {
            companions: topologyCompanions.map(role => ({
              role,
              ...(roleModels.get(role)
                ? { config: { model: roleModels.get(role) } }
                : {}),
            })),
          }
        : {}),
      ...(Object.keys(spawnRules).length > 0 ? { spawn_rules: spawnRules } : {}),
    },
  };

  // Communication section
  const hasComm =
    Object.keys(channels).length > 0 ||
    Object.keys(subscriptions).length > 0 ||
    Object.keys(emissions).length > 0 ||
    peerRoutes.length > 0;

  if (hasComm) {
    const communication: CommunicationConfig = {};

    if (team.enforcement !== 'permissive') {
      communication.enforcement = team.enforcement;
    }

    if (Object.keys(channels).length > 0) {
      communication.channels = channels;
    }

    // Filter out empty subscription arrays
    const filteredSubs: Record<string, SubscriptionEntry[]> = {};
    for (const [role, subs] of Object.entries(subscriptions)) {
      if (subs.length > 0) filteredSubs[role] = subs;
    }
    if (Object.keys(filteredSubs).length > 0) {
      communication.subscriptions = filteredSubs;
    }

    // Filter out empty emission arrays
    const filteredEmissions: Record<string, string[]> = {};
    for (const [role, sigs] of Object.entries(emissions)) {
      if (sigs.length > 0) filteredEmissions[role] = sigs;
    }
    if (Object.keys(filteredEmissions).length > 0) {
      communication.emissions = filteredEmissions;
    }

    if (peerRoutes.length > 0) {
      communication.routing = { peers: peerRoutes };
    }

    manifest.communication = communication;
  }

  // Extension fields
  for (const [key, value] of Object.entries(team.extensions)) {
    (manifest as Record<string, unknown>)[key] = value;
  }

  return manifest;
}

export function rolesToDefinitions(roles: Map<string, EditorRoleConfig>): Map<string, RoleDefinition> {
  const result = new Map<string, RoleDefinition>();
  for (const [name, role] of roles) {
    const def: RoleDefinition = {
      name: role.name,
    };
    if (role.displayName && role.displayName !== role.name) {
      def.display_name = role.displayName;
    }
    if (role.description) {
      def.description = role.description;
    }
    if (role.extends) {
      def.extends = role.extends;
    }
    if (role.capabilities.length > 0) {
      def.capabilities = role.capabilities;
    }
    result.set(name, def);
  }
  return result;
}
