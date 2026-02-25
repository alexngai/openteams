import { useUIStore } from '../../stores/ui-store';
import { useHistoryStore } from '../../stores/history-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { useConfigStore } from '../../stores/config-store';
import { useValidationStore } from '../../stores/validation-store';
import { useThemeStore } from '../../stores/theme-store';
import { computeLayout } from '../../lib/auto-layout';

export function Toolbar() {
  const { sidebarOpen, toggleSidebar, inspectorOpen, toggleInspector, layers, toggleLayer, setExportModalOpen, setImportModalOpen } = useUIStore();
  const historyStore = useHistoryStore();
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const { errors, warnings } = useValidationStore();
  const roleCount = useConfigStore(s => s.roles.size);
  const channelCount = Object.keys(useConfigStore(s => s.channels)).length;
  const { theme, setTheme } = useThemeStore();

  const cycleTheme = () => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
  };
  const themeIcon = theme === 'dark' ? '\u263E' : theme === 'light' ? '\u2600' : '\u25D0';
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

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
      background: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border)',
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

      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>OpenTeams Editor</span>

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
      <span style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Layers:</span>
      {(['peerRoutes', 'channels', 'spawnRules', 'inheritance'] as const).map(layer => (
        <button
          key={layer}
          onClick={() => toggleLayer(layer)}
          style={{
            ...btnStyle,
            background: layers[layer] ? 'var(--color-accent)' : undefined,
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
      <span data-testid="toolbar-status" style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>
        {roleCount} roles {'\u00B7'} {channelCount} ch
        {errors.length > 0 && <span data-testid="status-errors" style={{ color: 'var(--color-danger)', marginLeft: 6 }}>{errors.length} err</span>}
        {warnings.length > 0 && <span data-testid="status-warnings" style={{ color: 'var(--color-warning)', marginLeft: 6 }}>{warnings.length} warn</span>}
        {errors.length === 0 && warnings.length === 0 && <span data-testid="status-valid" style={{ color: 'var(--color-success)', marginLeft: 6 }}>{'\u2713'} valid</span>}
      </span>

      <button onClick={cycleTheme} style={btnStyle} title={`Theme: ${themeLabel}`} data-testid="btn-theme">
        {themeIcon}
      </button>

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
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  padding: '3px 8px',
  cursor: 'pointer',
  fontSize: '12px',
  color: 'var(--color-text-secondary)',
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '20px',
  background: 'var(--color-border)',
};
