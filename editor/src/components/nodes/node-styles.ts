import type { RoleNodeData } from '../../types/editor';
import { useThemeStore } from '../../stores/theme-store';

export type TopologyPosition = RoleNodeData['topologyPosition'];

export interface NodeColors {
  border: string;
  bg: string;
  badge: string;
}

const ROLE_COLORS: Record<TopologyPosition, NodeColors> = {
  root: {
    border: '#3b82f6',
    bg: '#eff6ff',       // blue-50
    badge: '#3b82f6',
  },
  companion: {
    border: '#14b8a6',
    bg: '#f0fdfa',       // teal-50
    badge: '#14b8a6',
  },
  spawned: {
    border: '#6b7280',
    bg: '#f9fafb',       // gray-50
    badge: '#6b7280',
  },
};

const DARK_ROLE_COLORS: Record<TopologyPosition, NodeColors> = {
  root: {
    border: '#3b82f6',
    bg: '#1e3a5f',
    badge: '#3b82f6',
  },
  companion: {
    border: '#14b8a6',
    bg: '#134e4a',
    badge: '#14b8a6',
  },
  spawned: {
    border: '#6b7280',
    bg: '#1f2937',
    badge: '#6b7280',
  },
};

function isDark(): boolean {
  return useThemeStore.getState().resolvedTheme === 'dark';
}

export function getRoleColors(position: TopologyPosition): NodeColors {
  return isDark() ? DARK_ROLE_COLORS[position] : ROLE_COLORS[position];
}

export const CHANNEL_COLORS: NodeColors = {
  border: '#8b5cf6',
  bg: '#faf5ff',       // purple-50
  badge: '#8b5cf6',
};

export const DARK_CHANNEL_COLORS: NodeColors = {
  border: '#8b5cf6',
  bg: '#2e1065',
  badge: '#8b5cf6',
};

export function getChannelColors(): NodeColors {
  return isDark() ? DARK_CHANNEL_COLORS : CHANNEL_COLORS;
}

export const TOPOLOGY_BADGES: Record<TopologyPosition, string> = {
  root: '\u2605',       // ★
  companion: '\u25C6',  // ◆
  spawned: '',
};

export function getBorderStyle(
  position: TopologyPosition,
  hasErrors: boolean,
  hasWarnings: boolean,
  isSelected: boolean,
): { borderColor: string; borderWidth: string; borderStyle: string } {
  const colors = getRoleColors(position);

  if (hasErrors) {
    return { borderColor: 'var(--color-danger)', borderWidth: '2px', borderStyle: 'solid' };
  }
  if (hasWarnings) {
    return { borderColor: 'var(--color-warning)', borderWidth: '2px', borderStyle: 'solid' };
  }
  if (isSelected) {
    return { borderColor: 'var(--color-accent)', borderWidth: '2px', borderStyle: 'solid' };
  }

  return {
    borderColor: colors.border,
    borderWidth: position === 'spawned' ? '1px' : '2px',
    borderStyle: position === 'spawned' ? 'dashed' : 'solid',
  };
}
