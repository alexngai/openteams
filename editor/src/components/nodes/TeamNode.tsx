import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { TeamNodeData } from '../../types/editor';
import { useThemeStore } from '../../stores/theme-store';

function TeamNodeComponent({ data, selected }: NodeProps & { data: TeamNodeData }) {
  const isDark = useThemeStore(s => s.resolvedTheme) === 'dark';
  const colors = isDark
    ? { border: '#f59e0b', bg: '#451a03', badge: '#f59e0b', text: '#fde68a' }
    : { border: '#f59e0b', bg: '#fffbeb', badge: '#f59e0b', text: '#92400e' };

  return (
    <div
      style={{
        borderColor: selected ? 'var(--color-accent)' : colors.border,
        borderWidth: '2px',
        borderStyle: 'solid',
        backgroundColor: colors.bg,
        borderRadius: '10px',
        padding: '0',
        minWidth: '260px',
        maxWidth: '300px',
        fontSize: '13px',
        boxShadow: selected ? '0 0 0 2px var(--color-accent)' : '0 2px 6px rgba(0,0,0,0.12)',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: colors.badge }} />
      <Handle type="source" position={Position.Bottom} style={{ background: colors.badge }} />

      {/* Header */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '16px' }}>{'\u{1F4E6}'}</span>
            <span style={{
              fontWeight: 700,
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {data.teamKey}
            </span>
          </div>
          {data.teamName !== data.teamKey && (
            <div style={{
              color: 'var(--color-text-muted)',
              fontSize: '12px',
              marginTop: '2px',
            }}>
              {data.teamName}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {data.description && (
        <div style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
          color: 'var(--color-text-muted)',
          fontSize: '11px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {data.description}
        </div>
      )}

      {/* Stats */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        gap: '10px',
        color: 'var(--color-text-muted)',
        fontSize: '12px',
      }}>
        <span>{data.roleCount} roles</span>
        <span>{'\u00B7'}</span>
        <span>{data.channelCount} ch</span>
      </div>

      {/* Exports/Imports */}
      <div style={{
        padding: '6px 12px',
        display: 'flex',
        gap: '10px',
        fontSize: '12px',
      }}>
        {data.exportCount > 0 && (
          <span style={{ color: '#22c55e' }}>
            {'\u25B2'} {data.exportCount} export{data.exportCount !== 1 ? 's' : ''}
          </span>
        )}
        {data.importCount > 0 && (
          <span style={{ color: '#3b82f6' }}>
            {'\u25BC'} {data.importCount} import{data.importCount !== 1 ? 's' : ''}
          </span>
        )}
        {data.exportCount === 0 && data.importCount === 0 && (
          <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>no federation ports</span>
        )}
      </div>
    </div>
  );
}

export const TeamNode = memo(TeamNodeComponent);
