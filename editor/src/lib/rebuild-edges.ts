import { useCanvasStore } from '../stores/canvas-store';
import { useConfigStore } from '../stores/config-store';
import type {
  EditorEdge,
  SignalFlowEdgeData,
  SpawnEdgeData,
  ChannelNodeData,
} from '../types/editor';

/**
 * Rebuild all derived edges (signal flow + spawn) from the config store.
 * Peer route edges are not rebuilt here — they are managed directly.
 * Also updates channel node emitter/subscriber counts.
 */
export function rebuildDerivedEdges() {
  const canvas = useCanvasStore.getState();
  const config = useConfigStore.getState();

  // Keep peer-route edges as-is
  const peerEdges = canvas.edges.filter(e => e.data?.kind === 'peer-route');

  const newEdges: EditorEdge[] = [...peerEdges];

  // Rebuild signal flow edges (emissions)
  for (const [role, roleSignals] of Object.entries(config.emissions)) {
    const channelSignals = new Map<string, string[]>();
    for (const sig of roleSignals) {
      for (const [chName, chDef] of Object.entries(config.channels)) {
        if (chDef.signals.includes(sig)) {
          const existing = channelSignals.get(chName) || [];
          existing.push(sig);
          channelSignals.set(chName, existing);
        }
      }
    }

    for (const [ch, sigs] of channelSignals) {
      const edgeData: SignalFlowEdgeData = {
        kind: 'signal-flow',
        direction: 'emission',
        channel: ch,
        signals: sigs,
      };
      newEdges.push({
        id: `emit-${role}-${ch}`,
        source: `role-${role}`,
        target: `channel-${ch}`,
        type: 'signal-flow',
        data: edgeData,
      });
    }
  }

  // Rebuild signal flow edges (subscriptions)
  for (const [role, roleSubs] of Object.entries(config.subscriptions)) {
    for (const sub of roleSubs) {
      const edgeData: SignalFlowEdgeData = {
        kind: 'signal-flow',
        direction: 'subscription',
        channel: sub.channel,
        signals: sub.signals || [],
      };
      newEdges.push({
        id: `sub-${sub.channel}-${role}`,
        source: `channel-${sub.channel}`,
        target: `role-${role}`,
        type: 'signal-flow',
        data: edgeData,
      });
    }
  }

  // Rebuild spawn edges
  for (const [fromRole, targets] of Object.entries(config.spawnRules)) {
    for (const toRole of targets) {
      const edgeData: SpawnEdgeData = { kind: 'spawn' };
      newEdges.push({
        id: `spawn-${fromRole}-${toRole}`,
        source: `role-${fromRole}`,
        target: `role-${toRole}`,
        type: 'spawn',
        data: edgeData,
      });
    }
  }

  canvas.setEdges(newEdges);

  // Update channel node counts
  for (const [chName, chDef] of Object.entries(config.channels)) {
    const emitterRoles = new Set<string>();
    for (const [role, sigs] of Object.entries(config.emissions)) {
      if (sigs.some(s => chDef.signals.includes(s))) emitterRoles.add(role);
    }
    const subscriberRoles = new Set<string>();
    for (const [role, subs] of Object.entries(config.subscriptions)) {
      if (subs.some(s => s.channel === chName)) subscriberRoles.add(role);
    }
    canvas.updateNodeData(`channel-${chName}`, {
      emitterCount: emitterRoles.size,
      subscriberCount: subscriberRoles.size,
    } as Partial<ChannelNodeData>);
  }
}
