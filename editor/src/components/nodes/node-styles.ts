import type { RoleNodeData } from '../../types/editor';

export type TopologyPosition = RoleNodeData['topologyPosition'];

export interface NodeColors {
  border: string;
  bg: string;
  badge: string;
}

const ROLE_COLORS: Record<TopologyPosition, NodeColors> = {
  root: {
    border: 'var(--ot-role-root)',
    bg: '#eff6ff',       // blue-50
    badge: '#3b82f6',
  },
  companion: {
    border: 'var(--ot-role-companion)',
    bg: '#f0fdfa',       // teal-50
    badge: '#14b8a6',
  },
  spawned: {
    border: 'var(--ot-role-spawned)',
    bg: '#f9fafb',       // gray-50
    badge: '#6b7280',
  },
};

const DARK_ROLE_COLORS: Record<TopologyPosition, NodeColors> = {
  root: {
    border: 'var(--ot-role-root)',
    bg: '#1e3a5f',
    badge: '#3b82f6',
  },
  companion: {
    border: 'var(--ot-role-companion)',
    bg: '#134e4a',
    badge: '#14b8a6',
  },
  spawned: {
    border: 'var(--ot-role-spawned)',
    bg: '#1f2937',
    badge: '#6b7280',
  },
};

export function getRoleColors(position: TopologyPosition, isDark = false): NodeColors {
  return isDark ? DARK_ROLE_COLORS[position] : ROLE_COLORS[position];
}

export const CHANNEL_COLORS: NodeColors = {
  border: 'var(--ot-channel)',
  bg: '#faf5ff',       // purple-50
  badge: '#8b5cf6',
};

export const DARK_CHANNEL_COLORS: NodeColors = {
  border: 'var(--ot-channel)',
  bg: '#2e1065',
  badge: '#8b5cf6',
};

export function getChannelColors(isDark = false): NodeColors {
  return isDark ? DARK_CHANNEL_COLORS : CHANNEL_COLORS;
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
  isDark = false,
): { borderColor: string; borderWidth: string; borderStyle: string } {
  const colors = getRoleColors(position, isDark);

  if (hasErrors) {
    return { borderColor: 'var(--ot-error)', borderWidth: '2px', borderStyle: 'solid' };
  }
  if (hasWarnings) {
    return { borderColor: 'var(--ot-warning)', borderWidth: '2px', borderStyle: 'solid' };
  }
  if (isSelected) {
    return { borderColor: 'var(--ot-accent)', borderWidth: '2px', borderStyle: 'solid' };
  }

  return {
    borderColor: colors.border,
    borderWidth: position === 'spawned' ? '1px' : '2px',
    borderStyle: position === 'spawned' ? 'dashed' : 'solid',
  };
}
