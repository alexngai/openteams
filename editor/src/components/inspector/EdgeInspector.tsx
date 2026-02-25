import type { EditorEdge } from '../../types/editor';
import { useConfigStore } from '../../stores/config-store';
import { useHistoryStore } from '../../stores/history-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { rebuildDerivedEdges } from '../../lib/rebuild-edges';

interface Props {
  edge: EditorEdge;
}

export function EdgeInspector({ edge }: Props) {
  const data = edge.data;
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);

  if (!data) return <div style={{ padding: 12 }}>Unknown edge</div>;

  if (data.kind === 'peer-route') {
    const fromRole = edge.source.replace('role-', '');
    const toRole = edge.target.replace('role-', '');

    const handleDelete = () => {
      pushSnapshot();
      const routes = useConfigStore.getState().peerRoutes;
      const idx = routes.findIndex(r => r.from === fromRole && r.to === toRole);
      if (idx >= 0) {
        useConfigStore.getState().removePeerRoute(idx);
      }
      useCanvasStore.getState().removeEdge(edge.id);
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={headerStyle}>Peer Route</div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <InfoRow label="From" value={fromRole} />
          <InfoRow label="To" value={toRole} />
          <InfoRow label="Via" value={data.via} />
          <div>
            <label style={labelStyle}>Signals</label>
            {data.signals.length === 0 ? (
              <div style={emptyStyle}>All signals</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {data.signals.map(sig => (
                  <span key={sig} style={tagStyle}>{sig}</span>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleDelete} style={deleteBtnStyle}>Delete Route</button>
        </div>
      </div>
    );
  }

  if (data.kind === 'signal-flow') {
    const isEmission = data.direction === 'emission';
    const role = isEmission ? edge.source.replace('role-', '') : edge.target.replace('role-', '');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={headerStyle}>Signal Flow ({data.direction})</div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <InfoRow label="Role" value={role} />
          <InfoRow label="Channel" value={data.channel} />
          <InfoRow label="Direction" value={isEmission ? 'Role \u2192 Channel' : 'Channel \u2192 Role'} />
          {data.signals.length > 0 && (
            <div>
              <label style={labelStyle}>Signals</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {data.signals.map(sig => (
                  <span key={sig} style={tagStyle}>{sig}</span>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: '11px', color: 'var(--ot-text-muted)', fontStyle: 'italic' }}>
            Modify via Role Inspector {'\u2192'} Communication tab
          </div>
        </div>
      </div>
    );
  }

  if (data.kind === 'spawn') {
    const from = edge.source.replace('role-', '');
    const to = edge.target.replace('role-', '');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={headerStyle}>Spawn Rule</div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <InfoRow label="From" value={from} />
          <InfoRow label="Can Spawn" value={to} />
          <div style={{ fontSize: '11px', color: 'var(--ot-text-muted)', fontStyle: 'italic' }}>
            Modify via Role Inspector {'\u2192'} Capabilities tab
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ fontSize: '12px', color: 'var(--ot-text)' }}>{value}</div>
    </div>
  );
}

const headerStyle: React.CSSProperties = { padding: '12px', borderBottom: '1px solid var(--ot-border)', fontWeight: 600, fontSize: '13px', color: 'var(--ot-text)' };
const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', display: 'block', marginBottom: '4px' };
const tagStyle: React.CSSProperties = { display: 'inline-flex', background: 'var(--ot-border)', color: 'var(--ot-text-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontFamily: 'monospace' };
const emptyStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--ot-text-muted)', fontStyle: 'italic' };
const deleteBtnStyle: React.CSSProperties = { background: 'var(--ot-error)', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', marginTop: '8px' };
