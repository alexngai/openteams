import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { RoleNodeData } from '../../types/editor';
import { getRoleColors, getBorderStyle, TOPOLOGY_BADGES } from './node-styles';

function RoleNodeComponent({ data, selected }: NodeProps & { data: RoleNodeData }) {
  const hasErrors = data.errors.length > 0;
  const hasWarnings = data.warnings.length > 0;
  const colors = getRoleColors(data.topologyPosition);
  const border = getBorderStyle(data.topologyPosition, hasErrors, hasWarnings, !!selected);
  const badge = TOPOLOGY_BADGES[data.topologyPosition];

  const subsCount = data.subscribesTo.length;
  const emitsCount = data.emits.length;
  const routesCount = data.peerRoutesOut + data.peerRoutesIn;

  const capDisplay = data.capabilities.slice(0, 2);
  const capExtra = data.capabilities.length - capDisplay.length;

  return (
    <div
      style={{
        borderColor: border.borderColor,
        borderWidth: border.borderWidth,
        borderStyle: border.borderStyle,
        backgroundColor: colors.bg,
        borderRadius: '8px',
        padding: '0',
        minWidth: '240px',
        maxWidth: '280px',
        fontSize: '12px',
        boxShadow: selected ? '0 0 0 2px var(--ot-accent)' : '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: colors.badge }} />
      <Handle type="source" position={Position.Right} style={{ background: colors.badge }} />

      {/* Header */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid var(--ot-border-subtle)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {badge && (
              <span style={{ color: colors.badge, fontSize: '13px' }}>{badge}</span>
            )}
            <span style={{
              fontWeight: 600,
              color: 'var(--ot-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {data.roleName}
            </span>
          </div>
          {data.displayName && data.displayName !== data.roleName && (
            <div style={{
              color: 'var(--ot-text-muted)',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: '1px',
            }}>
              {data.displayName}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {data.model && (
            <span style={{
              background: colors.badge,
              color: '#fff',
              padding: '1px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 500,
            }}>
              {data.model}
            </span>
          )}
          {hasErrors && (
            <span style={{
              background: 'var(--ot-error)',
              color: '#fff',
              padding: '1px 5px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 600,
            }}>
              {data.errors.length}
            </span>
          )}
          {hasWarnings && !hasErrors && (
            <span style={{
              background: 'var(--ot-warning)',
              color: '#000',
              padding: '1px 5px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 600,
            }}>
              {data.warnings.length}
            </span>
          )}
        </div>
      </div>

      {/* Capabilities */}
      {data.capabilities.length > 0 && (
        <div style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--ot-border-subtle)',
          color: 'var(--ot-text-muted)',
          fontSize: '11px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {capDisplay.join(' \u00B7 ')}
          {capExtra > 0 && ` \u00B7 +${capExtra}`}
        </div>
      )}

      {/* Signal summary */}
      <div style={{
        padding: '6px 10px',
        display: 'flex',
        gap: '8px',
        color: 'var(--ot-text-muted)',
        fontSize: '11px',
      }}>
        {emitsCount > 0 && (
          <span title="Signals emitted">{'\u25B2'} emits {emitsCount}</span>
        )}
        {subsCount > 0 && (
          <span title="Channel subscriptions">{'\u25BC'} subs {subsCount}</span>
        )}
        {routesCount > 0 && (
          <span title="Peer routes">{'\u2192'} routes {routesCount}</span>
        )}
        {emitsCount === 0 && subsCount === 0 && routesCount === 0 && (
          <span style={{ fontStyle: 'italic' }}>no communication</span>
        )}
      </div>
    </div>
  );
}

export const RoleNode = memo(RoleNodeComponent);
