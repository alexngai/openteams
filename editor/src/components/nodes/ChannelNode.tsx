import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { ChannelNodeData } from '../../types/editor';
import { getChannelColors } from './node-styles';

function ChannelNodeComponent({ data, selected }: NodeProps & { data: ChannelNodeData }) {
  const colors = getChannelColors();
  const maxSignals = 5;
  const displaySignals = data.signals.slice(0, maxSignals);
  const extraCount = data.signals.length - displaySignals.length;

  return (
    <div
      style={{
        borderColor: selected ? 'var(--color-accent)' : colors.border,
        borderWidth: '2px',
        borderStyle: 'solid',
        backgroundColor: colors.bg,
        borderRadius: '12px',
        padding: '0',
        minWidth: '200px',
        maxWidth: '240px',
        fontSize: '12px',
        boxShadow: selected ? '0 0 0 2px var(--color-accent)' : '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: colors.badge }} />
      <Handle type="source" position={Position.Bottom} style={{ background: colors.badge }} />

      {/* Header */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <div style={{
          fontWeight: 600,
          color: 'var(--color-text)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          <span style={{ color: colors.badge, fontSize: '13px' }}>{'\u25C6'}</span>
          {data.channelName}
        </div>
        {data.description && (
          <div style={{
            color: 'var(--color-text-muted)',
            fontSize: '10px',
            marginTop: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {data.description}
          </div>
        )}
      </div>

      {/* Signals */}
      <div style={{
        padding: '6px 10px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        {displaySignals.map(signal => (
          <div key={signal} style={{
            color: 'var(--color-text-secondary)',
            fontSize: '10px',
            fontFamily: 'monospace',
            padding: '1px 0',
          }}>
            {signal}
          </div>
        ))}
        {extraCount > 0 && (
          <div style={{
            color: 'var(--color-text-muted)',
            fontSize: '10px',
            fontStyle: 'italic',
          }}>
            +{extraCount} more
          </div>
        )}
      </div>

      {/* Summary */}
      <div style={{
        padding: '5px 10px',
        display: 'flex',
        gap: '8px',
        color: 'var(--color-text-muted)',
        fontSize: '10px',
      }}>
        <span>{data.emitterCount} emitter{data.emitterCount !== 1 ? 's' : ''}</span>
        <span>{'\u00B7'}</span>
        <span>{data.subscriberCount} subscriber{data.subscriberCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

export const ChannelNode = memo(ChannelNodeComponent);
