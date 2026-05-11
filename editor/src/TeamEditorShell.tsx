import { useEffect, type ReactNode } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './components/canvas/Canvas';
import { FederationCanvas } from './components/canvas/FederationCanvas';
import { Toolbar } from './components/toolbar/Toolbar';
import { Sidebar } from './components/sidebar/Sidebar';
import { FederationSidebar } from './components/sidebar/FederationSidebar';
import { Inspector } from './components/inspector/Inspector';
import { FederationInspector } from './components/inspector/FederationInspector';
import { ExportModal } from './components/toolbar/ExportModal';
import { ImportModal } from './components/toolbar/ImportModal';
import { useUIStore } from './stores/ui-store';
import { useKeyboard } from './hooks/use-keyboard';
import { useValidation } from './hooks/use-validation';
import { useAutosave } from './hooks/use-autosave';
import {
  EditorPersistenceProvider,
  defaultLocalStoragePersistence,
  type EditorPersistence,
} from './lib/persistence';
// Import theme store to initialize theme on load (side-effect-only).
import './stores/theme-store';

export interface TeamEditorShellProps {
  /**
   * Persistence adapter. Defaults to localStorage (matches standalone
   * SPA behaviour). Embedded consumers (OpenHive) pass a REST adapter
   * that targets `/api/v1/teams/:id`.
   */
  persistence?: EditorPersistence;
  /**
   * Render-prop slot for an initial template loader. Called once on mount.
   * The shell itself does NOT auto-load any bundled template — the SPA
   * entrypoint or the embedded host decides what to seed.
   */
  onMount?: () => void | Promise<void>;
  /**
   * Optional header injected between the toolbar and the canvas (e.g. a
   * breadcrumb back to the host app). Pure decoration.
   */
  header?: ReactNode;
}

/**
 * Library-mode shell for the openteams visual editor. Re-renders the same
 * canvas + sidebar + inspector + toolbar surface as the standalone SPA,
 * but accepts a persistence adapter and skips the auto-load of a default
 * template (host decides).
 */
export function TeamEditorShell(props: TeamEditorShellProps) {
  const persistence = props.persistence ?? defaultLocalStoragePersistence;

  return (
    <EditorPersistenceProvider value={persistence}>
      <TeamEditorShellInner onMount={props.onMount} header={props.header} />
    </EditorPersistenceProvider>
  );
}

function TeamEditorShellInner({
  onMount,
  header,
}: {
  onMount?: () => void | Promise<void>;
  header?: ReactNode;
}) {
  const { editorMode, sidebarOpen, inspectorOpen, exportModalOpen, importModalOpen, setExportModalOpen, setImportModalOpen } = useUIStore();

  useKeyboard();
  useValidation();
  useAutosave();

  useEffect(() => {
    if (onMount) {
      void onMount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFederation = editorMode === 'federation';

  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
        <Toolbar />
        {header}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {sidebarOpen && (isFederation ? <FederationSidebar /> : <Sidebar />)}
          {isFederation ? <FederationCanvas /> : <Canvas />}
          {inspectorOpen && (isFederation ? <FederationInspector /> : <Inspector />)}
        </div>
      </div>

      {exportModalOpen && <ExportModal onClose={() => setExportModalOpen(false)} />}
      {importModalOpen && <ImportModal onClose={() => setImportModalOpen(false)} />}
    </ReactFlowProvider>
  );
}
