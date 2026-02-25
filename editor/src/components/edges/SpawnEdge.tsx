import { memo, useState } from 'react';
import { BaseEdge, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

function SpawnEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  const isActive = selected || hovered;

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
          stroke: isActive ? '#9ca3af' : '#d1d5db',
          strokeWidth: isActive ? 1.5 : 1,
          strokeDasharray: '6 4',
          opacity: isActive ? 0.9 : 0.5,
        }}
      />
    </>
  );
}

export const SpawnEdge = memo(SpawnEdgeComponent);
