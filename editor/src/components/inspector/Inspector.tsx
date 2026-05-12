import { useCanvasStore } from '../../stores/canvas-store';
import { RoleInspector } from './RoleInspector';
import { ChannelInspector } from './ChannelInspector';
import { EdgeInspector } from './EdgeInspector';
import { LoadoutInspector } from './LoadoutInspector';
import { TeamInspector } from './TeamInspector';

export function Inspector() {
  const selectedNodeId = useCanvasStore(s => s.selectedNodeId);
  const selectedEdgeId = useCanvasStore(s => s.selectedEdgeId);
  const selectedLoadout = useCanvasStore(s => s.selectedLoadout);
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);

  let content: React.ReactNode;

  // Loadout selection is checked first because it's stored separately
  // from canvas node/edge selection; the three are mutually exclusive
  // in `setSelection`/`setSelectedLoadout`, but this dispatcher should
  // be tolerant of any out-of-band state.
  if (selectedLoadout) {
    content = <LoadoutInspector name={selectedLoadout} />;
  } else if (selectedNodeId) {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (node?.data.kind === 'role') {
      content = <RoleInspector nodeId={selectedNodeId} data={node.data} />;
    } else if (node?.data.kind === 'channel') {
      content = <ChannelInspector nodeId={selectedNodeId} data={node.data} />;
    }
  } else if (selectedEdgeId) {
    const edge = edges.find(e => e.id === selectedEdgeId);
    if (edge) {
      content = <EdgeInspector edge={edge} />;
    }
  }

  if (!content) {
    content = <TeamInspector />;
  }

  return (
    <div data-testid="inspector-panel" style={{
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
