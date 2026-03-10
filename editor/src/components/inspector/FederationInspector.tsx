import { useFederationStore } from '../../stores/federation-store';
import { FederationTeamInspector } from './FederationTeamInspector';
import { FederationBridgeInspector } from './FederationBridgeInspector';
import { FederationSettingsInspector } from './FederationSettingsInspector';

export function FederationInspector() {
  const selectedNodeId = useFederationStore(s => s.selectedNodeId);
  const selectedEdgeId = useFederationStore(s => s.selectedEdgeId);
  const nodes = useFederationStore(s => s.nodes);
  const edges = useFederationStore(s => s.edges);

  let content: React.ReactNode;

  if (selectedNodeId) {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (node) {
      const teamKey = node.data.teamKey;
      content = <FederationTeamInspector teamKey={teamKey} />;
    }
  } else if (selectedEdgeId) {
    const edge = edges.find(e => e.id === selectedEdgeId);
    if (edge) {
      const idx = parseInt(edge.id.replace('bridge-', ''), 10);
      content = <FederationBridgeInspector bridgeIndex={idx} />;
    }
  }

  if (!content) {
    content = <FederationSettingsInspector />;
  }

  return (
    <div data-testid="federation-inspector-panel" style={{
      width: '340px',
      background: 'var(--color-surface)',
      borderLeft: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {content}
    </div>
  );
}
