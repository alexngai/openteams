import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import type { NodeMouseHandler, EdgeMouseHandler, NodeTypes, EdgeTypes } from '@xyflow/react';
import { TeamNode } from '../nodes/TeamNode';
import { BridgeEdge } from '../edges/BridgeEdge';
import { useFederationStore } from '../../stores/federation-store';
import { useThemeStore } from '../../stores/theme-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: NodeTypes = {
  team: TeamNode,
} as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes: EdgeTypes = {
  bridge: BridgeEdge,
} as any;

export function FederationCanvas() {
  const nodes = useFederationStore(s => s.nodes);
  const edges = useFederationStore(s => s.edges);
  const setNodes = useFederationStore(s => s.setNodes);
  const setSelection = useFederationStore(s => s.setSelection);
  const resolvedTheme = useThemeStore(s => s.resolvedTheme);

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelection(node.id, null);
  }, [setSelection]);

  const handleEdgeClick: EdgeMouseHandler = useCallback((_, edge) => {
    setSelection(null, edge.id);
  }, [setSelection]);

  const handlePaneClick = useCallback(() => {
    setSelection(null, null);
  }, [setSelection]);

  return (
    <div style={{ flex: 1, height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes as any}
        edges={edges as any}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={resolvedTheme}
        fitView
        deleteKeyCode={null}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-canvas-dot)" />
        <Controls position="bottom-left" />
        <MiniMap
          position="bottom-right"
          style={{ marginBottom: 50 }}
          nodeColor={() => '#f59e0b'}
        />
        {/* Arrow marker for bridge edges */}
        <svg>
          <defs>
            <marker
              id="bridge-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
            </marker>
          </defs>
        </svg>
      </ReactFlow>
    </div>
  );
}
