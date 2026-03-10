import { useState, useCallback } from 'react';
import { useUIStore } from '../../stores/ui-store';
import { useHistoryStore } from '../../stores/history-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { useConfigStore } from '../../stores/config-store';
import { useValidationStore } from '../../stores/validation-store';
import { useThemeStore } from '../../stores/theme-store';
import { useFederationStore } from '../../stores/federation-store';
import { computeLayout } from '../../lib/auto-layout';
import { loadEmpty } from '../../lib/load-template';

export function Toolbar() {
  const { editorMode, setEditorMode, sidebarOpen, toggleSidebar, inspectorOpen, toggleInspector, layers, toggleLayer, setExportModalOpen, setImportModalOpen } = useUIStore();
  const historyStore = useHistoryStore();
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const { errors, warnings } = useValidationStore();
  const roleCount = useConfigStore(s => s.roles.size);
  const channelCount = Object.keys(useConfigStore(s => s.channels)).length;
  const { theme, setTheme } = useThemeStore();
  const federationTeamCount = useFederationStore(s => s.teams.size);
  const federationBridgeCount = useFederationStore(s => s.bridges.length);

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
      fontSize: '14px',
      flexShrink: 0,
    }}>
      {/* Left section */}
      <ToolbarBtn
        onClick={toggleSidebar}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        data-testid="toggle-sidebar"
      >
        {'\u2630'}
      </ToolbarBtn>

      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>openteams editor</span>

      {/* Mode Toggle */}
      <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: '4px', overflow: 'hidden', marginLeft: '4px' }}>
        <button
          onClick={() => setEditorMode('team')}
          data-testid="mode-team"
          style={{
            ...modeBtnBase,
            background: editorMode === 'team' ? 'var(--color-accent)' : 'none',
            color: editorMode === 'team' ? '#fff' : 'var(--color-text-secondary)',
          }}
        >
          Team
        </button>
        <button
          onClick={() => setEditorMode('federation')}
          data-testid="mode-federation"
          style={{
            ...modeBtnBase,
            background: editorMode === 'federation' ? '#f59e0b' : 'none',
            color: editorMode === 'federation' ? '#fff' : 'var(--color-text-secondary)',
          }}
        >
          Federation
        </button>
      </div>

      <div style={dividerStyle} />

      {editorMode === 'team' && (
        <>
          <ToolbarBtn onClick={() => loadEmpty()} title="Clear canvas" data-testid="btn-clear" icon={'\u2715'}>Clear</ToolbarBtn>
          <ToolbarBtn onClick={() => setImportModalOpen(true)} title="Import template" data-testid="btn-import" icon={'\u2191'}>Import</ToolbarBtn>
          <ToolbarBtn onClick={() => setExportModalOpen(true)} title="Export template" data-testid="btn-export" icon={'\u2193'}>Export</ToolbarBtn>

          <div style={dividerStyle} />

          <ToolbarBtn onClick={handleAutoLayout} title="Auto Layout" data-testid="btn-layout" icon={'\u2B1A'}>Layout</ToolbarBtn>
          <ToolbarBtn
            onClick={() => historyStore.undo()}
            disabled={!historyStore.canUndo()}
            title="Undo (Ctrl+Z)"
            data-testid="btn-undo"
            icon={'\u21A9'}
          >
            Undo
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => historyStore.redo()}
            disabled={!historyStore.canRedo()}
            title="Redo (Ctrl+Y)"
            data-testid="btn-redo"
            iconAfter={'\u21AA'}
          >
            Redo
          </ToolbarBtn>

          <div style={dividerStyle} />

          {/* Layer toggles */}
          <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>Layers:</span>
          {(['peerRoutes', 'channels', 'spawnRules', 'inheritance'] as const).map(layer => (
            <ToolbarBtn
              key={layer}
              onClick={() => toggleLayer(layer)}
              title={`Toggle ${layer}`}
              data-testid={`layer-${layer}`}
              active={layers[layer]}
            >
              {LAYER_LABELS[layer]}
            </ToolbarBtn>
          ))}
        </>
      )}

      {editorMode === 'federation' && (
        <>
          <ToolbarBtn onClick={() => setExportModalOpen(true)} title="Export federation" data-testid="btn-export-federation" icon={'\u2193'}>Export</ToolbarBtn>
          <ToolbarBtn onClick={() => setImportModalOpen(true)} title="Import federation" data-testid="btn-import-federation" icon={'\u2191'}>Import</ToolbarBtn>
        </>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Status */}
      <span data-testid="toolbar-status" style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>
        {editorMode === 'team' ? (
          <>
            {roleCount} roles {'\u00B7'} {channelCount} ch
            {errors.length > 0 && <span data-testid="status-errors" style={{ color: 'var(--color-danger)', marginLeft: 6 }}>{errors.length} err</span>}
            {warnings.length > 0 && <span data-testid="status-warnings" style={{ color: 'var(--color-warning)', marginLeft: 6 }}>{warnings.length} warn</span>}
            {errors.length === 0 && warnings.length === 0 && <span data-testid="status-valid" style={{ color: 'var(--color-success)', marginLeft: 6 }}>{'\u2713'} valid</span>}
          </>
        ) : (
          <>
            {federationTeamCount} team{federationTeamCount !== 1 ? 's' : ''} {'\u00B7'} {federationBridgeCount} bridge{federationBridgeCount !== 1 ? 's' : ''}
          </>
        )}
      </span>

      <ToolbarBtn onClick={cycleTheme} title={`Theme: ${themeLabel}`} data-testid="btn-theme">
        {themeIcon}
      </ToolbarBtn>

      <ToolbarBtn onClick={toggleInspector} title={inspectorOpen ? 'Hide inspector' : 'Show inspector'} data-testid="toggle-inspector">
        {inspectorOpen ? '\u00BB' : '\u00AB'}
      </ToolbarBtn>
    </div>
  );
}

function ToolbarBtn({ children, icon, iconAfter, active, disabled, ...rest }: {
  children: React.ReactNode;
  icon?: string;
  iconAfter?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  'data-testid'?: string;
}) {
  const [hovered, setHovered] = useState(false);

  const style: React.CSSProperties = {
    ...btnBase,
    background: active
      ? 'var(--color-accent-bg)'
      : hovered ? 'var(--color-hover)' : 'none',
    borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
    color: active
      ? 'var(--color-accent)'
      : hovered ? 'var(--color-text)' : 'var(--color-text-secondary)',
    opacity: disabled ? 0.4 : 1,
  };

  return (
    <button
      {...rest}
      disabled={disabled}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon && <span style={{ fontSize: '11px' }}>{icon}</span>}
      {children}
      {iconAfter && <span style={{ fontSize: '11px' }}>{iconAfter}</span>}
    </button>
  );
}

const LAYER_LABELS: Record<string, string> = {
  peerRoutes: 'Routes',
  channels: 'Channels',
  spawnRules: 'Spawn',
  inheritance: 'Inherit',
};

const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  padding: '3px 8px',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--color-text-secondary)',
  transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
};

const modeBtnBase: React.CSSProperties = {
  padding: '3px 10px',
  fontSize: '12px',
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  transition: 'background 120ms ease, color 120ms ease',
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '20px',
  background: 'var(--color-border)',
};
