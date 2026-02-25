import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './components/canvas/Canvas';
import { Toolbar } from './components/toolbar/Toolbar';
import { Sidebar } from './components/sidebar/Sidebar';
import { Inspector } from './components/inspector/Inspector';
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
  const { sidebarOpen, inspectorOpen, exportModalOpen, importModalOpen, setExportModalOpen, setImportModalOpen } = useUIStore();

  useKeyboard();
  useValidation();
  useAutosave();

  // Load default template on mount
  useEffect(() => {
    const template = BUNDLED_TEMPLATES['get-shit-done'];
    if (template) {
      loadTemplate(template.manifest, template.roles);
    }
  }, []);

  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
        <Toolbar />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {sidebarOpen && <Sidebar />}
          <Canvas />
          {inspectorOpen && <Inspector />}
        </div>
      </div>

      {exportModalOpen && <ExportModal onClose={() => setExportModalOpen(false)} />}
      {importModalOpen && <ImportModal onClose={() => setImportModalOpen(false)} />}
    </ReactFlowProvider>
  );
}
