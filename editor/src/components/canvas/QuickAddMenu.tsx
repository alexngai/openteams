import { useConfigStore } from '../../stores/config-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { useHistoryStore } from '../../stores/history-store';
import type { RoleNodeData, ChannelNodeData } from '../../types/editor';

interface Props {
  position: { x: number; y: number };
  canvasPosition: { x: number; y: number };
  onClose: () => void;
}

export function QuickAddMenu({ position, canvasPosition, onClose }: Props) {
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
      position: canvasPosition,
      data,
    });

    canvas.setSelection(`role-${name}`, null);
    onClose();
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

    const data: ChannelNodeData = {
      kind: 'channel',
      channelName: name,
      description: '',
      signals: ['NEW_SIGNAL'],
      emitterCount: 0,
      subscriberCount: 0,
    };

    canvas.addNode({
      id: `channel-${name}`,
      type: 'channel',
      position: canvasPosition,
      data,
    });

    canvas.setSelection(`channel-${name}`, null);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        background: 'var(--color-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        zIndex: 100,
        overflow: 'hidden',
        minWidth: '140px',
      }}
      onClick={e => e.stopPropagation()}
    >
      <button onClick={handleAddRole} style={menuItemStyle}>
        <span style={{ color: '#3b82f6' }}>{'\u25CF'}</span> New Role
      </button>
      <button onClick={handleAddChannel} style={menuItemStyle}>
        <span style={{ color: '#8b5cf6' }}>{'\u25C6'}</span> New Channel
      </button>
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '8px 12px',
  background: 'none',
  border: 'none',
  borderBottom: '1px solid var(--color-border-subtle)',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--color-text)',
  textAlign: 'left' as const,
};
