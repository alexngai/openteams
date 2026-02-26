import { useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
} from '@xyflow/react';
import type { NodeMouseHandler, EdgeMouseHandler, NodeTypes, EdgeTypes } from '@xyflow/react';
import { RoleNode } from '../nodes/RoleNode';
import { ChannelNode } from '../nodes/ChannelNode';
import { PeerRouteEdge } from '../edges/PeerRouteEdge';
import { SignalFlowEdge } from '../edges/SignalFlowEdge';
import { SpawnEdge } from '../edges/SpawnEdge';
import { QuickAddMenu } from './QuickAddMenu';
import { useCanvasStore } from '../../stores/canvas-store';
import { useUIStore } from '../../stores/ui-store';
import { useThemeStore } from '../../stores/theme-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: NodeTypes = {
  role: RoleNode,
  channel: ChannelNode,
} as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes: EdgeTypes = {
  'peer-route': PeerRouteEdge,
  'signal-flow': SignalFlowEdge,
  spawn: SpawnEdge,
} as any;

interface QuickAddState {
  screen: { x: number; y: number };
  canvas: { x: number; y: number };
}

export function Canvas() {
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const onNodesChange = useCanvasStore(s => s.onNodesChange);
  const onEdgesChange = useCanvasStore(s => s.onEdgesChange);
  const setSelection = useCanvasStore(s => s.setSelection);
  const layers = useUIStore(s => s.layers);
  const resolvedTheme = useThemeStore(s => s.resolvedTheme);
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const reactFlow = useReactFlow();

  // Filter edges based on active layers
  const visibleEdges = edges.filter(edge => {
    const data = edge.data;
    if (!data) return true;
    if (data.kind === 'peer-route') return layers.peerRoutes;
    if (data.kind === 'signal-flow') return layers.channels;
    if (data.kind === 'spawn') return layers.spawnRules;
    return true;
  });

  // Filter out channel nodes when channel layer is off
  const visibleNodes = nodes.filter(node => {
    if (node.data.kind === 'channel') return layers.channels;
    return true;
  });

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelection(node.id, null);
    setQuickAdd(null);
  }, [setSelection]);

  const handleEdgeClick: EdgeMouseHandler = useCallback((_, edge) => {
    setSelection(null, edge.id);
    setQuickAdd(null);
  }, [setSelection]);

  const handlePaneClick = useCallback(() => {
    setSelection(null, null);
    setQuickAdd(null);
  }, [setSelection]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const canvasPos = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setQuickAdd({
      screen: { x: e.clientX, y: e.clientY },
      canvas: canvasPos,
    });
  }, [reactFlow]);

  return (
    <div style={{ flex: 1, height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={visibleNodes as any}
        edges={visibleEdges as any}
        onNodesChange={onNodesChange as any}
        onEdgesChange={onEdgesChange as any}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onDoubleClick={handleDoubleClick}
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
          nodeColor={(node) => {
            const data = node.data as { kind: string; topologyPosition?: string };
            if (data.kind === 'channel') return '#8b5cf6';
            if (data.topologyPosition === 'root') return '#3b82f6';
            if (data.topologyPosition === 'companion') return '#14b8a6';
            return '#6b7280';
          }}
        />
      </ReactFlow>
      {quickAdd && (
        <QuickAddMenu
          position={quickAdd.screen}
          canvasPosition={quickAdd.canvas}
          onClose={() => setQuickAdd(null)}
        />
      )}
    </div>
  );
}
