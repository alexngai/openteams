import { useCanvasStore } from '../../stores/canvas-store';
import { RoleInspector } from './RoleInspector';
import { ChannelInspector } from './ChannelInspector';
import { EdgeInspector } from './EdgeInspector';
import { TeamInspector } from './TeamInspector';

export function Inspector() {
  const selectedNodeId = useCanvasStore(s => s.selectedNodeId);
  const selectedEdgeId = useCanvasStore(s => s.selectedEdgeId);
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);

  let content: React.ReactNode;

  if (selectedNodeId) {
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
    <div style={{
      width: '340px',
      background: 'var(--ot-surface)',
      borderLeft: '1px solid var(--ot-border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {content}
    </div>
  );
}
