import { memo } from 'react';
import { getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { BridgeEdgeData } from '../../types/editor';

function BridgeEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps & { data: BridgeEdgeData }) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const label = `${data.fromSignal} \u2192 ${data.toChannel}`;

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={selected ? 'var(--color-accent)' : '#f59e0b'}
        strokeWidth={selected ? 3 : 2}
        strokeDasharray="6 3"
        markerEnd="url(#bridge-arrow)"
      />
      {/* Label */}
      <foreignObject
        x={labelX - 80}
        y={labelY - 12}
        width={160}
        height={24}
        requiredExtensions="http://www.w3.org/1999/xhtml"
      >
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '10px',
            fontFamily: 'monospace',
            color: selected ? 'var(--color-accent)' : '#f59e0b',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </div>
      </foreignObject>
    </>
  );
}

export const BridgeEdge = memo(BridgeEdgeComponent);
