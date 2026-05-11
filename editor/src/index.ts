/**
 * Library entry point for `openteams-editor`.
 *
 * The standalone SPA continues to load `main.tsx`; embedded consumers
 * (e.g. OpenHive's `/teams/:id/editor` page) import the named exports
 * here. React, ReactDOM, Zustand, and `@xyflow/react` are externalized
 * as peer dependencies so the host's instances win, avoiding duplicate
 * React trees / context fragmentation.
 *
 * Style import: consumers should also import
 * `'openteams-editor/styles.css'` to pick up the editor's CSS variables
 * + Tailwind layer. The library build emits a single bundled
 * stylesheet alongside the JS — pulled in via this side-effect import
 * so Vite's CSS pipeline picks it up.
 */

// Side-effect import — anchors the stylesheet for the library build.
import './index.css';

export { TeamEditorShell } from './TeamEditorShell';
export type { TeamEditorShellProps } from './TeamEditorShell';

// Components — pulled out individually so hosts can build custom layouts.
export { Canvas } from './components/canvas/Canvas';
export { FederationCanvas } from './components/canvas/FederationCanvas';
export { Toolbar } from './components/toolbar/Toolbar';
export { Sidebar } from './components/sidebar/Sidebar';
export { FederationSidebar } from './components/sidebar/FederationSidebar';
export { Inspector } from './components/inspector/Inspector';
export { FederationInspector } from './components/inspector/FederationInspector';
export { ExportModal } from './components/toolbar/ExportModal';
export { ImportModal } from './components/toolbar/ImportModal';

// Stores — exported so hosts can read/dispatch from outside the shell
// (e.g. to drive an explicit "load this team_template_id" effect).
export { useConfigStore } from './stores/config-store';
export { useCanvasStore } from './stores/canvas-store';
export { useUIStore } from './stores/ui-store';
export { useHistoryStore } from './stores/history-store';
export { useFederationStore } from './stores/federation-store';
export { useValidationStore } from './stores/validation-store';

// Persistence — the contract host adapters implement.
export {
  EditorPersistenceProvider,
  defaultLocalStoragePersistence,
  useEditorPersistence,
} from './lib/persistence';
export type {
  EditorPersistence,
  EditorSavedState,
  EditorPersistenceSaveResult,
} from './lib/persistence';

// Template helpers — for hosts seeding from server-side fixtures.
export { loadTemplate } from './lib/load-template';
export { compileToYaml } from './lib/compiler';
export { BUNDLED_TEMPLATES } from './lib/bundled-templates';

// Autosave hook + saved-state helpers — useful for hosts driving manual
// save flows.
export { useAutosave, loadSavedState, clearSavedState } from './hooks/use-autosave';
export type { SavedState } from './hooks/use-autosave';
