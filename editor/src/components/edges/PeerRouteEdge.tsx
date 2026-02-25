import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { PeerRouteEdgeData } from '../../types/editor';

function PeerRouteEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps & { data?: PeerRouteEdgeData }) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  const isActive = selected || hovered;
  const strokeColor = isActive ? '#f59e0b' : '#d97706';

  const label = data?.signals?.join(', ') || '';

  return (
    <>
      {/* Invisible hit area */}
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
          strokeWidth: isActive ? 3 : 2.5,
          animation: hovered && !selected ? 'ot-edge-flow 0.6s linear infinite' : undefined,
          strokeDasharray: hovered && !selected ? '6 4' : undefined,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
              background: isActive ? '#fef3c7' : 'var(--color-surface)',
              border: `1px solid ${isActive ? '#f59e0b' : 'var(--color-border)'}`,
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '9px',
              fontFamily: 'monospace',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'nowrap',
              maxWidth: '180px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PeerRouteEdge = memo(PeerRouteEdgeComponent);
