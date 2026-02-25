/**
 * Theme store: manages dark/light/system theme with persistence.
 * Mirrors the OpenHive theme pattern for visual coherence.
 */

import { create } from 'zustand';

type Theme = 'dark' | 'light' | 'system';

interface ThemeStore {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
}

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): 'dark' | 'light' {
  return theme === 'system' ? getSystemTheme() : theme;
}

function applyTheme(resolved: 'dark' | 'light') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
}

// Hydrate from localStorage
function loadPersistedTheme(): Theme {
  try {
    const stored = localStorage.getItem('ot-editor-theme');
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch { /* ignore */ }
  return 'dark';
}

const initialTheme = loadPersistedTheme();
const initialResolved = resolveTheme(initialTheme);
applyTheme(initialResolved);

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initialTheme,
  resolvedTheme: initialResolved,
  setTheme: (theme: Theme) => {
    const resolvedTheme = resolveTheme(theme);
    applyTheme(resolvedTheme);
    try { localStorage.setItem('ot-editor-theme', theme); } catch { /* ignore */ }
    set({ theme, resolvedTheme });
  },
}));

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const state = useThemeStore.getState();
    if (state.theme === 'system') {
      const resolvedTheme = e.matches ? 'dark' : 'light';
      applyTheme(resolvedTheme);
      useThemeStore.setState({ resolvedTheme });
    }
  });
}
