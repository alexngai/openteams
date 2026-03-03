/**
 * E2E: Undo/redo flow
 * Tests that undo/redo correctly restores previous states
 * across both canvas and config stores.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../src/stores/canvas-store';
import { useConfigStore } from '../src/stores/config-store';
import { useHistoryStore } from '../src/stores/history-store';
import { useValidationStore } from '../src/stores/validation-store';
import { BUNDLED_TEMPLATES } from '../src/lib/bundled-templates';
import { loadTemplate } from '../src/lib/load-template';
import type { RoleNodeData } from '../src/types/editor';

function resetStores() {
  useCanvasStore.getState().clear();
  useConfigStore.getState().clear();
  useHistoryStore.getState().clear();
  useValidationStore.getState().clear();
}

function addRole(name: string) {
  const store = useConfigStore.getState();
  const canvas = useCanvasStore.getState();
  const history = useHistoryStore.getState();

  history.pushSnapshot();

  store.setRole(name, {
    name,
    displayName: name,
    description: '',
    capabilities: [],
  });

  canvas.addNode({
    id: `role-${name}`,
    type: 'role',
    position: { x: 100, y: 100 },
    data: {
      kind: 'role',
      roleName: name,
      displayName: name,
      description: '',
      topologyPosition: 'spawned',
      capabilities: [],
      emits: [],
      subscribesTo: [],
      peerRoutesOut: 0,
      peerRoutesIn: 0,
      canSpawn: [],
      errors: [],
      warnings: [],
    } as RoleNodeData,
  });
}

describe('E2E: Undo/redo', () => {
  beforeEach(resetStores);

  it('undo restores previous role count', () => {
    addRole('first');
    addRole('second');

    expect(useConfigStore.getState().roles.size).toBe(2);
    expect(useCanvasStore.getState().nodes.length).toBe(2);

    useHistoryStore.getState().undo();

    expect(useConfigStore.getState().roles.size).toBe(1);
    expect(useCanvasStore.getState().nodes.length).toBe(1);
    expect(useConfigStore.getState().roles.has('first')).toBe(true);
    expect(useConfigStore.getState().roles.has('second')).toBe(false);
  });

  it('redo re-applies undone change', () => {
    addRole('first');
    addRole('second');

    useHistoryStore.getState().undo();
    expect(useConfigStore.getState().roles.size).toBe(1);

    useHistoryStore.getState().redo();
    expect(useConfigStore.getState().roles.size).toBe(2);
    expect(useCanvasStore.getState().nodes.length).toBe(2);
  });

  it('undo restores previous team name', () => {
    // Set initial state
    useHistoryStore.getState().pushSnapshot();
    useConfigStore.getState().setTeam({ name: 'original-name' });

    useHistoryStore.getState().pushSnapshot();
    useConfigStore.getState().setTeam({ name: 'changed-name' });

    expect(useConfigStore.getState().team.name).toBe('changed-name');

    useHistoryStore.getState().undo();
    expect(useConfigStore.getState().team.name).toBe('original-name');
  });

  it('multiple undos restore to empty state', () => {
    addRole('a');
    addRole('b');
    addRole('c');

    expect(useConfigStore.getState().roles.size).toBe(3);

    useHistoryStore.getState().undo(); // remove c
    useHistoryStore.getState().undo(); // remove b
    useHistoryStore.getState().undo(); // remove a

    expect(useConfigStore.getState().roles.size).toBe(0);
    expect(useCanvasStore.getState().nodes.length).toBe(0);
  });

  it('undo after redo keeps correct state', () => {
    addRole('first');
    addRole('second');

    useHistoryStore.getState().undo(); // back to 1 role
    useHistoryStore.getState().redo(); // forward to 2 roles
    useHistoryStore.getState().undo(); // back to 1 role again

    expect(useConfigStore.getState().roles.size).toBe(1);
  });

  it('new action clears redo stack', () => {
    addRole('first');
    addRole('second');

    useHistoryStore.getState().undo(); // redo stack has 1 entry
    expect(useHistoryStore.getState().canRedo()).toBe(true);

    addRole('third'); // new action should clear redo
    expect(useHistoryStore.getState().canRedo()).toBe(false);
  });

  it('canUndo and canRedo reflect correct state', () => {
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(useHistoryStore.getState().canRedo()).toBe(false);

    addRole('first');
    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(useHistoryStore.getState().canRedo()).toBe(false);

    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(useHistoryStore.getState().canRedo()).toBe(true);
  });

  it('undo/redo restores topology changes', () => {
    addRole('leader');
    useHistoryStore.getState().pushSnapshot();
    useConfigStore.getState().setTopologyRoot('leader');

    expect(useConfigStore.getState().topologyRoot).toBe('leader');

    useHistoryStore.getState().undo();
    expect(useConfigStore.getState().topologyRoot).toBe('');
  });

  it('undo/redo restores model assignments', () => {
    addRole('agent');

    useHistoryStore.getState().pushSnapshot();
    useConfigStore.getState().setRoleModel('agent', 'opus');

    expect(useConfigStore.getState().roleModels['agent']).toBe('opus');

    useHistoryStore.getState().undo();
    expect(useConfigStore.getState().roleModels['agent']).toBeUndefined();
  });

  it('undo/redo preserves deep state (channels, subscriptions)', () => {
    addRole('worker');
    useHistoryStore.getState().pushSnapshot();
    useConfigStore.getState().setChannel('events', { signals: ['SIG_A'] });
    useConfigStore.getState().setSubscriptions('worker', [{ channel: 'events' }]);

    expect(Object.keys(useConfigStore.getState().channels)).toContain('events');
    expect(useConfigStore.getState().subscriptions['worker']).toHaveLength(1);

    useHistoryStore.getState().undo();
    expect(useConfigStore.getState().channels['events']).toBeUndefined();
    expect(useConfigStore.getState().subscriptions['worker']).toBeUndefined();
  });

  it('undo on loaded template restores initial state', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const initialRoleCount = useConfigStore.getState().roles.size;

    // Make a change
    useHistoryStore.getState().pushSnapshot();
    useConfigStore.getState().setTeam({ name: 'modified' });

    useHistoryStore.getState().undo();
    expect(useConfigStore.getState().team.name).toBe('gsd');
    expect(useConfigStore.getState().roles.size).toBe(initialRoleCount);
  });
});
