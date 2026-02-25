import { useConfigStore } from '../../stores/config-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { useHistoryStore } from '../../stores/history-store';
import { rebuildDerivedEdges } from '../../lib/rebuild-edges';
import type { ChannelNodeData } from '../../types/editor';

interface Props {
  nodeId: string;
  data: ChannelNodeData;
}

export function ChannelInspector({ nodeId, data }: Props) {
  const configStore = useConfigStore();
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);
  const channel = configStore.channels[data.channelName];

  if (!channel) return <div style={{ padding: 12 }}>Channel not found</div>;

  // Derive emitters and subscribers
  const emitters: { role: string; signals: string[] }[] = [];
  for (const [role, signals] of Object.entries(configStore.emissions)) {
    const matching = signals.filter(s => channel.signals.includes(s));
    if (matching.length > 0) emitters.push({ role, signals: matching });
  }

  const subscribers: { role: string; signals: string[] | 'all' }[] = [];
  for (const [role, subs] of Object.entries(configStore.subscriptions)) {
    for (const sub of subs) {
      if (sub.channel === data.channelName) {
        subscribers.push({ role, signals: sub.signals || 'all' });
      }
    }
  }

  const handleRenameChannel = (newName: string) => {
    if (!newName || newName === data.channelName) return;
    if (configStore.channels[newName]) {
      alert(`Channel "${newName}" already exists.`);
      return;
    }
    pushSnapshot();
    // Create new channel, remove old
    const config = useConfigStore.getState();
    config.setChannel(newName, channel);
    config.removeChannel(data.channelName);
    // Update subscriptions referencing old channel name
    for (const [role, subs] of Object.entries(config.subscriptions)) {
      const updated = subs.map(s =>
        s.channel === data.channelName ? { ...s, channel: newName } : s
      );
      if (updated.some((s, i) => s !== subs[i])) {
        config.setSubscriptions(role, updated);
      }
    }
    // Update canvas node
    useCanvasStore.getState().updateNodeData(nodeId, { channelName: newName });
    // Rebuild derived edges (they reference channel names)
    rebuildDerivedEdges();
  };

  const handleUpdateDescription = (description: string) => {
    pushSnapshot();
    useConfigStore.getState().setChannel(data.channelName, { ...channel, description });
    useCanvasStore.getState().updateNodeData(nodeId, { description });
  };

  const handleRemoveSignal = (signal: string) => {
    pushSnapshot();
    const updated = { ...channel, signals: channel.signals.filter(s => s !== signal) };
    useConfigStore.getState().setChannel(data.channelName, updated);
    useCanvasStore.getState().updateNodeData(nodeId, { signals: updated.signals });
    rebuildDerivedEdges();
  };

  const handleAddSignal = () => {
    const signal = prompt('Signal name (UPPER_CASE):');
    if (!signal) return;
    pushSnapshot();
    const updated = { ...channel, signals: [...channel.signals, signal] };
    useConfigStore.getState().setChannel(data.channelName, updated);
    useCanvasStore.getState().updateNodeData(nodeId, { signals: updated.signals });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--ot-border)',
        fontWeight: 600,
        fontSize: '13px',
        color: 'var(--ot-text)',
      }}>
        Channel: {data.channelName}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input
            style={inputStyle}
            defaultValue={data.channelName}
            onBlur={e => handleRenameChannel(e.target.value.trim())}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </div>
        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            style={{ ...inputStyle, minHeight: '50px', resize: 'vertical' }}
            value={channel.description || ''}
            onChange={e => handleUpdateDescription(e.target.value)}
          />
        </div>

        <div>
          <label style={labelStyle}>Signals</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {channel.signals.map(sig => (
              <span key={sig} style={tagStyle}>
                {sig}
                <button onClick={() => handleRemoveSignal(sig)} style={tagRemoveBtn}>{'\u00D7'}</button>
              </span>
            ))}
            <button onClick={handleAddSignal} style={addBtnStyle}>+</button>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Emitters (derived)</label>
          {emitters.length === 0 && <div style={emptyStyle}>None</div>}
          {emitters.map(e => (
            <div key={e.role} style={{ fontSize: '11px', padding: '2px 0', color: 'var(--ot-text-secondary)' }}>
              {e.role} {'\u2192'} {e.signals.join(', ')}
            </div>
          ))}
        </div>

        <div>
          <label style={labelStyle}>Subscribers (derived)</label>
          {subscribers.length === 0 && <div style={emptyStyle}>None</div>}
          {subscribers.map((s, i) => (
            <div key={i} style={{ fontSize: '11px', padding: '2px 0', color: 'var(--ot-text-secondary)' }}>
              {s.role} {'\u2190'} {s.signals === 'all' ? 'all signals' : s.signals.join(', ')}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', display: 'block', marginBottom: '4px' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '6px 8px', fontSize: '12px', border: '1px solid var(--ot-border)', borderRadius: '4px', background: 'var(--ot-bg)', color: 'var(--ot-text)', boxSizing: 'border-box' as const };
const tagStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '2px', background: 'var(--ot-border)', color: 'var(--ot-text-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontFamily: 'monospace' };
const tagRemoveBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ot-text-muted)', padding: '0 2px', fontSize: '12px' };
const addBtnStyle: React.CSSProperties = { background: 'none', border: '1px dashed var(--ot-border)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px', color: 'var(--ot-text-muted)' };
const emptyStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--ot-text-muted)', fontStyle: 'italic' };
