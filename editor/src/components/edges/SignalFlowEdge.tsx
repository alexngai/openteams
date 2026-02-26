import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { SignalFlowEdgeData } from '../../types/editor';

function SignalFlowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps & { data?: SignalFlowEdgeData }) {
  const [hovered, setHovered] = useState(false);
  const offset = data?.pathOffset as { sourceX: number; sourceY: number; targetX: number; targetY: number } | undefined;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: sourceX + (offset?.sourceX ?? 0),
    sourceY: sourceY + (offset?.sourceY ?? 0),
    targetX: targetX + (offset?.targetX ?? 0),
    targetY: targetY + (offset?.targetY ?? 0),
    sourcePosition,
    targetPosition,
  });

  const isActive = selected || hovered;
  const strokeColor = isActive ? '#9ca3af' : '#d1d5db';

  const label = data?.channel || '';

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth: isActive ? 2 : 1.5,
          strokeDasharray: data?.direction === 'subscription' ? '4 3' : undefined,
        }}
      />
      {label && isActive && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '9px',
              fontFamily: 'monospace',
              color: 'var(--color-text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {data?.direction === 'emission' ? '\u25B2' : '\u25BC'} {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const SignalFlowEdge = memo(SignalFlowEdgeComponent);
