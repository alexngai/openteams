import { useUIStore } from '../../stores/ui-store';
import { useHistoryStore } from '../../stores/history-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { useConfigStore } from '../../stores/config-store';
import { useValidationStore } from '../../stores/validation-store';
import { computeLayout } from '../../lib/auto-layout';

export function Toolbar() {
  const { sidebarOpen, toggleSidebar, inspectorOpen, toggleInspector, layers, toggleLayer, setExportModalOpen, setImportModalOpen } = useUIStore();
  const historyStore = useHistoryStore();
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const { errors, warnings } = useValidationStore();
  const roleCount = useConfigStore(s => s.roles.size);
  const channelCount = Object.keys(useConfigStore(s => s.channels)).length;

  const handleAutoLayout = () => {
    historyStore.pushSnapshot();
    const layoutNodes = computeLayout(
      useCanvasStore.getState().nodes,
      useCanvasStore.getState().edges,
    );
    useCanvasStore.getState().setNodes(layoutNodes);
  };

  return (
    <div style={{
      height: '40px',
      background: 'var(--ot-surface)',
      borderBottom: '1px solid var(--ot-border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: '8px',
      fontSize: '13px',
      flexShrink: 0,
    }}>
      {/* Left section */}
      <button
        onClick={toggleSidebar}
        style={btnStyle}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        data-testid="toggle-sidebar"
      >
        {'\u2630'}
      </button>

      <span style={{ fontWeight: 600, color: 'var(--ot-text)' }}>OpenTeams Editor</span>

      <div style={dividerStyle} />

      <button onClick={() => setImportModalOpen(true)} style={btnStyle} data-testid="btn-import">Import</button>
      <button onClick={() => setExportModalOpen(true)} style={btnStyle} data-testid="btn-export">Export</button>

      <div style={dividerStyle} />

      <button onClick={handleAutoLayout} style={btnStyle} title="Auto Layout" data-testid="btn-layout">Layout</button>
      <button
        onClick={() => historyStore.undo()}
        disabled={!historyStore.canUndo()}
        style={btnStyle}
        title="Undo (Ctrl+Z)"
        data-testid="btn-undo"
      >
        Undo
      </button>
      <button
        onClick={() => historyStore.redo()}
        disabled={!historyStore.canRedo()}
        style={btnStyle}
        title="Redo (Ctrl+Y)"
        data-testid="btn-redo"
      >
        Redo
      </button>

      <div style={dividerStyle} />

      {/* Layer toggles */}
      <span style={{ color: 'var(--ot-text-muted)', fontSize: '11px' }}>Layers:</span>
      {(['peerRoutes', 'channels', 'spawnRules', 'inheritance'] as const).map(layer => (
        <button
          key={layer}
          onClick={() => toggleLayer(layer)}
          style={{
            ...btnStyle,
            background: layers[layer] ? 'var(--ot-accent)' : undefined,
            color: layers[layer] ? '#fff' : undefined,
          }}
          title={`Toggle ${layer}`}
          data-testid={`layer-${layer}`}
        >
          {LAYER_LABELS[layer]}
        </button>
      ))}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Status */}
      <span data-testid="toolbar-status" style={{ color: 'var(--ot-text-muted)', fontSize: '11px' }}>
        {roleCount} roles {'\u00B7'} {channelCount} ch
        {errors.length > 0 && <span data-testid="status-errors" style={{ color: 'var(--ot-error)', marginLeft: 6 }}>{errors.length} err</span>}
        {warnings.length > 0 && <span data-testid="status-warnings" style={{ color: 'var(--ot-warning)', marginLeft: 6 }}>{warnings.length} warn</span>}
        {errors.length === 0 && warnings.length === 0 && <span data-testid="status-valid" style={{ color: 'var(--ot-success)', marginLeft: 6 }}>{'\u2713'} valid</span>}
      </span>

      <button onClick={toggleInspector} style={btnStyle} title={inspectorOpen ? 'Hide inspector' : 'Show inspector'} data-testid="toggle-inspector">
        {inspectorOpen ? '\u00BB' : '\u00AB'}
      </button>
    </div>
  );
}

const LAYER_LABELS: Record<string, string> = {
  peerRoutes: 'Routes',
  channels: 'Channels',
  spawnRules: 'Spawn',
  inheritance: 'Inherit',
};

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--ot-border)',
  borderRadius: '4px',
  padding: '3px 8px',
  cursor: 'pointer',
  fontSize: '12px',
  color: 'var(--ot-text-secondary)',
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '20px',
  background: 'var(--ot-border)',
};
