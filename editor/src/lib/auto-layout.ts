import dagre from '@dagrejs/dagre';
import type { EditorNode, EditorEdge } from '../types/editor';

const ROLE_NODE_WIDTH = 280;
const ROLE_NODE_HEIGHT = 120;
const CHANNEL_NODE_WIDTH = 220;
const CHANNEL_NODE_HEIGHT = 100;

export function computeLayout(nodes: EditorNode[], edges: EditorEdge[]): EditorNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    ranksep: 120,
    nodesep: 80,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const isChannel = node.data.kind === 'channel';
    g.setNode(node.id, {
      width: isChannel ? CHANNEL_NODE_WIDTH : ROLE_NODE_WIDTH,
      height: isChannel ? CHANNEL_NODE_HEIGHT : ROLE_NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    // Only use peer routes and signal flow for layout; skip spawn edges
    if (edge.data?.kind !== 'spawn') {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return nodes.map(node => {
    const pos = g.node(node.id);
    if (!pos) return node;

    const isChannel = node.data.kind === 'channel';
    const w = isChannel ? CHANNEL_NODE_WIDTH : ROLE_NODE_WIDTH;
    const h = isChannel ? CHANNEL_NODE_HEIGHT : ROLE_NODE_HEIGHT;
    return {
      ...node,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });
}
