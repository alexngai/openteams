import { useEffect } from 'react';
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
// Import theme store to initialize theme on load
import './stores/theme-store';
import { BUNDLED_TEMPLATES } from './lib/bundled-templates';
import { loadTemplate } from './lib/load-template';

export default function App() {
  const { editorMode, sidebarOpen, inspectorOpen, exportModalOpen, importModalOpen, setExportModalOpen, setImportModalOpen } = useUIStore();

  useKeyboard();
  useValidation();
  useAutosave();

  // Load default template on mount
  useEffect(() => {
    const template = BUNDLED_TEMPLATES['gsd'];
    if (template) {
      loadTemplate(template.manifest, template.roles);
    }
  }, []);

  const isFederation = editorMode === 'federation';

  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
        <Toolbar />
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
