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

    const findRouteIndex = () => {
      return useConfigStore.getState().peerRoutes.findIndex(
        r => r.from === fromRole && r.to === toRole
      );
    };

    const updateRoute = (updates: Partial<{ via: string; signals: string[] }>) => {
      pushSnapshot();
      const routes = [...useConfigStore.getState().peerRoutes];
      const idx = findRouteIndex();
      if (idx < 0) return;
      routes[idx] = { ...routes[idx], ...updates } as any;
      useConfigStore.getState().setPeerRoutes(routes);
      // Update edge data on canvas
      const edgeUpdates: Record<string, unknown> = {};
      if (updates.via) edgeUpdates.via = updates.via;
      if (updates.signals) edgeUpdates.signals = updates.signals;
      const canvas = useCanvasStore.getState();
      const updatedEdges = canvas.edges.map(e =>
        e.id === edge.id ? { ...e, data: { ...e.data, ...edgeUpdates } } : e
      );
      canvas.setEdges(updatedEdges as any);
    };

    const handleDelete = () => {
      pushSnapshot();
      const idx = findRouteIndex();
      if (idx >= 0) {
        useConfigStore.getState().removePeerRoute(idx);
      }
      useCanvasStore.getState().removeEdge(edge.id);
    };

    const handleRemoveSignal = (signal: string) => {
      updateRoute({ signals: data.signals.filter(s => s !== signal) });
    };

    const handleAddSignal = () => {
      const signal = prompt('Signal name (UPPER_CASE):');
      if (!signal) return;
      updateRoute({ signals: [...data.signals, signal] });
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={headerStyle}>Peer Route</div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <InfoRow label="From" value={fromRole} />
          <InfoRow label="To" value={toRole} />
          <div>
            <label style={labelStyle}>Via</label>
            <select
              style={selectStyle}
              value={data.via}
              onChange={e => updateRoute({ via: e.target.value })}
            >
              <option value="direct">direct</option>
              <option value="topic">topic</option>
              <option value="scope">scope</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Signals</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {data.signals.length === 0 && (
                <div style={emptyStyle}>All signals</div>
              )}
              {data.signals.map(sig => (
                <span key={sig} style={tagStyle}>
                  {sig}
                  <button onClick={() => handleRemoveSignal(sig)} style={tagRemoveBtn}>{'\u00D7'}</button>
                </span>
              ))}
              <button onClick={handleAddSignal} style={addBtnStyle}>+</button>
            </div>
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
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
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
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
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
      <div style={{ fontSize: '13px', color: 'var(--color-text)' }}>{value}</div>
    </div>
  );
}

const headerStyle: React.CSSProperties = { padding: '12px', borderBottom: '1px solid var(--color-border)', fontWeight: 600, fontSize: '14px', color: 'var(--color-text)' };
const labelStyle: React.CSSProperties = { fontSize: '13px', fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' };
const selectStyle: React.CSSProperties = { width: '100%', padding: '6px 8px', fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box' as const };
const tagStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '2px', background: 'var(--color-border)', color: 'var(--color-text-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' };
const tagRemoveBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0 2px', fontSize: '12px' };
const addBtnStyle: React.CSSProperties = { background: 'none', border: '1px dashed var(--color-border)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '13px', color: 'var(--color-text-muted)' };
const emptyStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--color-text-muted)', fontStyle: 'italic' };
const deleteBtnStyle: React.CSSProperties = { background: 'var(--color-danger)', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px', marginTop: '8px' };
