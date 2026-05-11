import { TeamEditorShell } from './TeamEditorShell';
import { BUNDLED_TEMPLATES } from './lib/bundled-templates';
import { loadTemplate } from './lib/load-template';

/**
 * Standalone SPA entrypoint. The reusable surface lives in
 * `TeamEditorShell`; this file is the SPA-specific shim that auto-loads
 * the `gsd` bundled template on first mount. Embedded consumers (e.g.
 * OpenHive) skip this entrypoint and import `TeamEditorShell` directly
 * from the library.
 */
export default function App() {
  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <TeamEditorShell
        onMount={() => {
          const template = BUNDLED_TEMPLATES['gsd'];
          if (template) loadTemplate(template.manifest, template.roles);
        }}
      />
    </div>
  );
}
