import { memo, useState } from 'react';
import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { SpawnEdgeData } from '../../types/editor';

function SpawnEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps & { data?: SpawnEdgeData }) {
  const [hovered, setHovered] = useState(false);
  const offset = data?.pathOffset as { sourceX: number; sourceY: number; targetX: number; targetY: number } | undefined;
  const [edgePath] = getSmoothStepPath({
    sourceX: sourceX + (offset?.sourceX ?? 0),
    sourceY: sourceY + (offset?.sourceY ?? 0),
    targetX: targetX + (offset?.targetX ?? 0),
    targetY: targetY + (offset?.targetY ?? 0),
    sourcePosition,
    targetPosition,
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
