/**
 * E2E: UI store and layer toggles
 * Tests the UI state management, panel visibility,
 * and layer toggling behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../src/stores/ui-store';

function resetUI() {
  // Reset to defaults by toggling back if needed
  const state = useUIStore.getState();
  if (!state.sidebarOpen) state.toggleSidebar();
  if (!state.inspectorOpen) state.toggleInspector();
  if (state.importModalOpen) state.setImportModalOpen(false);
  if (state.exportModalOpen) state.setExportModalOpen(false);
  // Reset layers to defaults
  if (!state.layers.peerRoutes) state.toggleLayer('peerRoutes');
  if (!state.layers.channels) state.toggleLayer('channels');
  if (state.layers.spawnRules) state.toggleLayer('spawnRules');
  if (state.layers.inheritance) state.toggleLayer('inheritance');
}

describe('E2E: UI store and layers', () => {
  beforeEach(resetUI);

  describe('Panel visibility', () => {
    it('sidebar starts open', () => {
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('toggle sidebar hides and shows it', () => {
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(false);

      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('inspector starts open', () => {
      expect(useUIStore.getState().inspectorOpen).toBe(true);
    });

    it('toggle inspector hides and shows it', () => {
      useUIStore.getState().toggleInspector();
      expect(useUIStore.getState().inspectorOpen).toBe(false);

      useUIStore.getState().toggleInspector();
      expect(useUIStore.getState().inspectorOpen).toBe(true);
    });

    it('modals start closed', () => {
      expect(useUIStore.getState().importModalOpen).toBe(false);
      expect(useUIStore.getState().exportModalOpen).toBe(false);
    });

    it('opening import modal', () => {
      useUIStore.getState().setImportModalOpen(true);
      expect(useUIStore.getState().importModalOpen).toBe(true);

      useUIStore.getState().setImportModalOpen(false);
      expect(useUIStore.getState().importModalOpen).toBe(false);
    });

    it('opening export modal', () => {
      useUIStore.getState().setExportModalOpen(true);
      expect(useUIStore.getState().exportModalOpen).toBe(true);
    });
  });

  describe('Layer toggles', () => {
    it('peer routes layer starts on', () => {
      expect(useUIStore.getState().layers.peerRoutes).toBe(true);
    });

    it('channels layer starts on', () => {
      expect(useUIStore.getState().layers.channels).toBe(true);
    });

    it('spawn rules layer starts off', () => {
      expect(useUIStore.getState().layers.spawnRules).toBe(false);
    });

    it('inheritance layer starts off', () => {
      expect(useUIStore.getState().layers.inheritance).toBe(false);
    });

    it('toggling a layer flips its state', () => {
      useUIStore.getState().toggleLayer('peerRoutes');
      expect(useUIStore.getState().layers.peerRoutes).toBe(false);

      useUIStore.getState().toggleLayer('peerRoutes');
      expect(useUIStore.getState().layers.peerRoutes).toBe(true);
    });

    it('toggling one layer does not affect others', () => {
      useUIStore.getState().toggleLayer('spawnRules');

      expect(useUIStore.getState().layers.spawnRules).toBe(true);
      expect(useUIStore.getState().layers.peerRoutes).toBe(true);
      expect(useUIStore.getState().layers.channels).toBe(true);
      expect(useUIStore.getState().layers.inheritance).toBe(false);
    });

    it('all layers can be turned on simultaneously', () => {
      useUIStore.getState().toggleLayer('spawnRules');
      useUIStore.getState().toggleLayer('inheritance');

      const layers = useUIStore.getState().layers;
      expect(layers.peerRoutes).toBe(true);
      expect(layers.channels).toBe(true);
      expect(layers.spawnRules).toBe(true);
      expect(layers.inheritance).toBe(true);
    });

    it('all layers can be turned off simultaneously', () => {
      useUIStore.getState().toggleLayer('peerRoutes');
      useUIStore.getState().toggleLayer('channels');

      const layers = useUIStore.getState().layers;
      expect(layers.peerRoutes).toBe(false);
      expect(layers.channels).toBe(false);
      expect(layers.spawnRules).toBe(false);
      expect(layers.inheritance).toBe(false);
    });
  });
});
