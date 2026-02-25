import { useEffect } from 'react';
import { useHistoryStore } from '../stores/history-store';
import { useCanvasStore } from '../stores/canvas-store';
import { useConfigStore } from '../stores/config-store';
import { useUIStore } from '../stores/ui-store';
import { rebuildDerivedEdges } from '../lib/rebuild-edges';

export function useKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Undo: Ctrl/Cmd+Z
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useHistoryStore.getState().undo();
        return;
      }

      // Redo: Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z
      if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useHistoryStore.getState().redo();
        return;
      }

      // Toggle inspector: Ctrl/Cmd+I
      if (isMod && e.key === 'i') {
        e.preventDefault();
        useUIStore.getState().toggleInspector();
        return;
      }

      // Export: Ctrl/Cmd+E
      if (isMod && e.key === 'e') {
        e.preventDefault();
        useUIStore.getState().setExportModalOpen(true);
        return;
      }

      // Escape: deselect or close modals
      if (e.key === 'Escape') {
        const ui = useUIStore.getState();
        if (ui.importModalOpen) { ui.setImportModalOpen(false); return; }
        if (ui.exportModalOpen) { ui.setExportModalOpen(false); return; }
        useCanvasStore.getState().setSelection(null, null);
        return;
      }

      // Delete/Backspace: delete selected node or edge
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete if user is typing in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        const canvas = useCanvasStore.getState();
        const config = useConfigStore.getState();
        const history = useHistoryStore.getState();

        if (canvas.selectedEdgeId) {
          const edge = canvas.edges.find(e2 => e2.id === canvas.selectedEdgeId);
          if (edge?.data?.kind === 'peer-route') {
            const fromRole = edge.source.replace('role-', '');
            const toRole = edge.target.replace('role-', '');
            history.pushSnapshot();
            const idx = config.peerRoutes.findIndex(r => r.from === fromRole && r.to === toRole);
            if (idx >= 0) config.removePeerRoute(idx);
            canvas.removeEdge(edge.id);
          }
          return;
        }

        if (canvas.selectedNodeId) {
          const node = canvas.nodes.find(n => n.id === canvas.selectedNodeId);
          if (!node) return;

          history.pushSnapshot();

          if (node.data.kind === 'role') {
            config.removeRole(node.data.roleName);
            canvas.removeNode(node.id);
            rebuildDerivedEdges();
          } else if (node.data.kind === 'channel') {
            config.removeChannel(node.data.channelName);
            canvas.removeNode(node.id);
            rebuildDerivedEdges();
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
