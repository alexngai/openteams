import { useConfigStore } from '../../stores/config-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { useHistoryStore } from '../../stores/history-store';
import { BUNDLED_TEMPLATES } from '../../lib/bundled-templates';
import { loadTemplate } from '../../lib/load-template';
import type { RoleNodeData } from '../../types/editor';

export function Sidebar() {
  const roles = useConfigStore(s => s.roles);
  const channels = useConfigStore(s => s.channels);
  const topologyRoot = useConfigStore(s => s.topologyRoot);
  const topologyCompanions = useConfigStore(s => s.topologyCompanions);
  const setSelection = useCanvasStore(s => s.setSelection);

  const handleLoadTemplate = (key: string) => {
    const template = BUNDLED_TEMPLATES[key];
    if (template) {
      loadTemplate(template.manifest, template.roles);
    }
  };

  const handleAddRole = () => {
    const store = useConfigStore.getState();
    const canvas = useCanvasStore.getState();
    const history = useHistoryStore.getState();

    let name = 'new-role';
    let i = 1;
    while (store.roles.has(name)) {
      name = `new-role-${i++}`;
    }

    history.pushSnapshot();

    store.setRole(name, {
      name,
      displayName: name,
      description: '',
      capabilities: [],
    });

    const data: RoleNodeData = {
      kind: 'role',
      roleName: name,
      displayName: name,
      description: '',
      topologyPosition: 'spawned',
      capabilities: [],
      emits: [],
      subscribesTo: [],
      peerRoutesOut: 0,
      peerRoutesIn: 0,
      canSpawn: [],
      errors: [],
      warnings: [],
    };

    canvas.addNode({
      id: `role-${name}`,
      type: 'role',
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data,
    });

    setSelection(`role-${name}`, null);
  };

  const handleAddChannel = () => {
    const store = useConfigStore.getState();
    const canvas = useCanvasStore.getState();
    const history = useHistoryStore.getState();

    let name = 'new_channel';
    let i = 1;
    while (store.channels[name]) {
      name = `new_channel_${i++}`;
    }

    history.pushSnapshot();

    store.setChannel(name, { signals: ['NEW_SIGNAL'] });

    canvas.addNode({
      id: `channel-${name}`,
      type: 'channel',
      position: { x: 300 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: {
        kind: 'channel',
        channelName: name,
        description: '',
        signals: ['NEW_SIGNAL'],
        emitterCount: 0,
        subscriberCount: 0,
      },
    });

    setSelection(`channel-${name}`, null);
  };

  return (
    <div style={{
      width: '240px',
      background: 'var(--ot-sidebar)',
      borderRight: '1px solid var(--ot-border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Block Palette */}
      <div style={{ padding: '12px', borderBottom: '1px solid var(--ot-border)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Add Blocks
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={handleAddRole} style={blockBtnStyle('#3b82f6')} data-testid="add-role">
            + Role
          </button>
          <button onClick={handleAddChannel} style={blockBtnStyle('#8b5cf6')} data-testid="add-channel">
            + Channel
          </button>
        </div>
      </div>

      {/* Config Tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Roles ({roles.size})
        </div>
        {Array.from(roles.keys()).map(name => {
          const isRoot = name === topologyRoot;
          const isCompanion = topologyCompanions.includes(name);
          return (
            <div
              key={name}
              onClick={() => setSelection(`role-${name}`, null)}
              data-testid={`sidebar-role-${name}`}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--ot-text)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'var(--ot-border)')}
              onMouseOut={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ color: isRoot ? '#3b82f6' : isCompanion ? '#14b8a6' : '#6b7280', fontSize: '10px' }}>
                {isRoot ? '\u2605' : isCompanion ? '\u25C6' : '\u25CB'}
              </span>
              {name}
            </div>
          );
        })}

        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', marginTop: '16px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Channels ({Object.keys(channels).length})
        </div>
        {Object.keys(channels).map(name => (
          <div
            key={name}
            onClick={() => setSelection(`channel-${name}`, null)}
            data-testid={`sidebar-channel-${name}`}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '12px',
              color: 'var(--ot-text)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            onMouseOver={e => (e.currentTarget.style.background = 'var(--ot-border)')}
            onMouseOut={e => (e.currentTarget.style.background = 'none')}
          >
            <span style={{ color: '#8b5cf6', fontSize: '10px' }}>{'\u25C6'}</span>
            {name}
          </div>
        ))}
      </div>

      {/* Template Gallery */}
      <div style={{ padding: '12px', borderTop: '1px solid var(--ot-border)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Templates
        </div>
        {Object.entries(BUNDLED_TEMPLATES).map(([key, tmpl]) => (
          <button
            key={key}
            onClick={() => handleLoadTemplate(key)}
            data-testid={`template-${key}`}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'var(--ot-elevated)',
              border: '1px solid var(--ot-border)',
              borderRadius: '6px',
              padding: '8px',
              marginBottom: '6px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--ot-text)' }}>{key}</div>
            <div style={{ color: 'var(--ot-text-muted)', marginTop: '2px' }}>
              {tmpl.manifest.roles.length} roles {'\u00B7'} {Object.keys(tmpl.manifest.communication?.channels || {}).length} channels
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function blockBtnStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    background: color,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '12px',
  };
}
