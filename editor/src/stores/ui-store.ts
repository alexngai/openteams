import { create } from 'zustand';

interface Layers {
  peerRoutes: boolean;
  channels: boolean;
  spawnRules: boolean;
  inheritance: boolean;
}

interface UIStore {
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  importModalOpen: boolean;
  exportModalOpen: boolean;
  layers: Layers;

  toggleSidebar: () => void;
  toggleInspector: () => void;
  setImportModalOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;
  toggleLayer: (layer: keyof Layers) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  sidebarOpen: true,
  inspectorOpen: true,
  importModalOpen: false,
  exportModalOpen: false,
  layers: {
    peerRoutes: true,
    channels: true,
    spawnRules: false,
    inheritance: false,
  },

  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  toggleInspector: () => set({ inspectorOpen: !get().inspectorOpen }),
  setImportModalOpen: (open) => set({ importModalOpen: open }),
  setExportModalOpen: (open) => set({ exportModalOpen: open }),

  toggleLayer: (layer) => {
    const layers = { ...get().layers };
    layers[layer] = !layers[layer];
    set({ layers });
  },
}));
