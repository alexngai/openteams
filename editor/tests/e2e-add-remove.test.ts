/**
 * E2E: Add and remove roles/channels flow
 * Tests the full flow of adding roles, channels, modifying them,
 * and removing them, verifying consistency across stores.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../src/stores/canvas-store';
import { useConfigStore } from '../src/stores/config-store';
import { useHistoryStore } from '../src/stores/history-store';
import { useValidationStore } from '../src/stores/validation-store';
import { BUNDLED_TEMPLATES } from '../src/lib/bundled-templates';
import { loadTemplate } from '../src/lib/load-template';
import { rebuildDerivedEdges } from '../src/lib/rebuild-edges';
import type { RoleNodeData, ChannelNodeData } from '../src/types/editor';

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

  const data: RoleNodeData = {
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
  };

  canvas.addNode({
    id: `role-${name}`,
    type: 'role',
    position: { x: 100, y: 100 },
    data,
  });
}

function addChannel(name: string, signals: string[] = ['TEST_SIGNAL']) {
  const store = useConfigStore.getState();
  const canvas = useCanvasStore.getState();
  const history = useHistoryStore.getState();

  history.pushSnapshot();

  store.setChannel(name, { signals });

  canvas.addNode({
    id: `channel-${name}`,
    type: 'channel',
    position: { x: 300, y: 100 },
    data: {
      kind: 'channel',
      channelName: name,
      description: '',
      signals,
      emitterCount: 0,
      subscriberCount: 0,
    } as ChannelNodeData,
  });
}

describe('E2E: Add and remove roles/channels', () => {
  beforeEach(resetStores);

  describe('Adding roles', () => {
    it('adds a role to both config and canvas stores', () => {
      addRole('test-role');

      const config = useConfigStore.getState();
      expect(config.roles.has('test-role')).toBe(true);

      const canvas = useCanvasStore.getState();
      const node = canvas.nodes.find(n => n.id === 'role-test-role');
      expect(node).toBeDefined();
      expect(node?.data.kind).toBe('role');
      expect((node?.data as RoleNodeData).roleName).toBe('test-role');
    });

    it('adding multiple roles results in correct counts', () => {
      addRole('alpha');
      addRole('beta');
      addRole('gamma');

      expect(useConfigStore.getState().roles.size).toBe(3);
      expect(useCanvasStore.getState().nodes.length).toBe(3);
    });

    it('creates undo snapshots when adding roles', () => {
      addRole('role-1');
      addRole('role-2');

      const history = useHistoryStore.getState();
      expect(history.undoStack.length).toBe(2);
    });
  });

  describe('Adding channels', () => {
    it('adds a channel to both config and canvas stores', () => {
      addChannel('events', ['EVENT_A', 'EVENT_B']);

      const config = useConfigStore.getState();
      expect(config.channels.events).toBeDefined();
      expect(config.channels.events.signals).toEqual(['EVENT_A', 'EVENT_B']);

      const canvas = useCanvasStore.getState();
      const node = canvas.nodes.find(n => n.id === 'channel-events');
      expect(node).toBeDefined();
      expect((node?.data as ChannelNodeData).channelName).toBe('events');
    });
  });

  describe('Removing roles', () => {
    it('removes role from config store and cleans up references', () => {
      // Set up a team with roles and connections
      addRole('leader');
      addRole('worker');

      const config = useConfigStore.getState();
      config.setTopologyRoot('leader');
      config.setEmissions('worker', ['DONE_SIGNAL']);
      config.setSubscriptions('worker', [{ channel: 'events' }]);
      config.setSpawnRules('leader', ['worker']);
      config.addPeerRoute({ from: 'leader', to: 'worker', via: 'direct' });

      // Remove worker
      config.removeRole('worker');

      const updated = useConfigStore.getState();
      expect(updated.roles.has('worker')).toBe(false);
      expect(updated.emissions['worker']).toBeUndefined();
      expect(updated.subscriptions['worker']).toBeUndefined();
      expect(updated.spawnRules['leader']).toEqual([]);
      expect(updated.peerRoutes.length).toBe(0);
    });

    it('removes role node from canvas when removeNode is called', () => {
      addRole('to-remove');
      useCanvasStore.getState().removeNode('role-to-remove');

      expect(useCanvasStore.getState().nodes.length).toBe(0);
    });

    it('clears selection when selected node is removed', () => {
      addRole('selected');
      useCanvasStore.getState().setSelection('role-selected', null);
      expect(useCanvasStore.getState().selectedNodeId).toBe('role-selected');

      useCanvasStore.getState().removeNode('role-selected');
      expect(useCanvasStore.getState().selectedNodeId).toBeNull();
    });
  });

  describe('Removing channels', () => {
    it('removes channel and cleans up subscriptions', () => {
      addRole('worker');
      addChannel('events', ['TASK_DONE']);

      const config = useConfigStore.getState();
      config.setSubscriptions('worker', [{ channel: 'events' }]);

      config.removeChannel('events');

      const updated = useConfigStore.getState();
      expect(updated.channels['events']).toBeUndefined();
      // Subscription referencing removed channel should be cleaned
      expect(updated.subscriptions['worker']).toEqual([]);
    });
  });

  describe('Modifying roles', () => {
    it('updates role display name in config store', () => {
      addRole('my-role');
      const config = useConfigStore.getState();
      config.setRole('my-role', {
        ...config.roles.get('my-role')!,
        displayName: 'My Custom Role',
      });

      expect(useConfigStore.getState().roles.get('my-role')?.displayName).toBe('My Custom Role');
    });

    it('updates role capabilities', () => {
      addRole('capable');
      const config = useConfigStore.getState();
      config.setRole('capable', {
        ...config.roles.get('capable')!,
        capabilities: ['read', 'write', 'admin'],
      });

      expect(useConfigStore.getState().roles.get('capable')?.capabilities).toEqual(['read', 'write', 'admin']);
    });

    it('sets role model in config store', () => {
      addRole('smart');
      useConfigStore.getState().setRoleModel('smart', 'opus');

      expect(useConfigStore.getState().roleModels['smart']).toBe('opus');
    });

    it('clears role model when set to undefined', () => {
      addRole('clear-model');
      useConfigStore.getState().setRoleModel('clear-model', 'opus');
      useConfigStore.getState().setRoleModel('clear-model', undefined);

      expect(useConfigStore.getState().roleModels['clear-model']).toBeUndefined();
    });

    it('updates node data on canvas', () => {
      addRole('update-me');
      useCanvasStore.getState().updateNodeData('role-update-me', {
        displayName: 'Updated Name',
        model: 'haiku',
      });

      const node = useCanvasStore.getState().nodes.find(n => n.id === 'role-update-me');
      expect((node?.data as RoleNodeData).displayName).toBe('Updated Name');
      expect((node?.data as RoleNodeData).model).toBe('haiku');
    });
  });

  describe('Renaming roles', () => {
    it('renames role across all stores', () => {
      addRole('old-name');
      const config = useConfigStore.getState();
      config.setTopologyRoot('old-name');
      config.setEmissions('old-name', ['SIG_A']);
      config.setSubscriptions('old-name', [{ channel: 'ch' }]);
      config.setSpawnRules('old-name', []);
      config.setRoleModel('old-name', 'sonnet');
      config.addPeerRoute({ from: 'old-name', to: 'other', via: 'direct' });

      config.renameRole('old-name', 'new-name');

      const updated = useConfigStore.getState();
      expect(updated.roles.has('old-name')).toBe(false);
      expect(updated.roles.has('new-name')).toBe(true);
      expect(updated.roles.get('new-name')?.name).toBe('new-name');
      expect(updated.topologyRoot).toBe('new-name');
      expect(updated.emissions['new-name']).toEqual(['SIG_A']);
      expect(updated.subscriptions['new-name']).toEqual([{ channel: 'ch' }]);
      expect(updated.roleModels['new-name']).toBe('sonnet');
      expect(updated.peerRoutes[0].from).toBe('new-name');
    });
  });

  describe('Add roles to a loaded template', () => {
    it('adds a new role to an existing template', () => {
      const tmpl = BUNDLED_TEMPLATES['gsd'];
      loadTemplate(tmpl.manifest, tmpl.roles);

      const initialRoleCount = useConfigStore.getState().roles.size;
      const initialNodeCount = useCanvasStore.getState().nodes.length;

      addRole('custom-agent');

      expect(useConfigStore.getState().roles.size).toBe(initialRoleCount + 1);
      expect(useCanvasStore.getState().nodes.length).toBe(initialNodeCount + 1);
    });

    it('new role gets added to spawn rules of existing role', () => {
      const tmpl = BUNDLED_TEMPLATES['gsd'];
      loadTemplate(tmpl.manifest, tmpl.roles);

      addRole('helper');
      useConfigStore.getState().setSpawnRules('orchestrator', [
        ...useConfigStore.getState().spawnRules['orchestrator'],
        'helper',
      ]);

      expect(useConfigStore.getState().spawnRules['orchestrator']).toContain('helper');
    });
  });

  describe('Edge management after modifications', () => {
    it('rebuilds derived edges after adding emission', () => {
      addRole('emitter');
      addChannel('events', ['TASK_DONE']);

      useConfigStore.getState().setEmissions('emitter', ['TASK_DONE']);
      rebuildDerivedEdges();

      const edges = useCanvasStore.getState().edges;
      const emitEdge = edges.find(e => e.id === 'emit-emitter-events');
      expect(emitEdge).toBeDefined();
      expect(emitEdge?.data?.kind).toBe('signal-flow');
    });

    it('rebuilds derived edges after adding subscription', () => {
      addRole('subscriber');
      addChannel('events', ['UPDATE']);

      useConfigStore.getState().setSubscriptions('subscriber', [{ channel: 'events' }]);
      rebuildDerivedEdges();

      const edges = useCanvasStore.getState().edges;
      const subEdge = edges.find(e => e.id === 'sub-events-subscriber');
      expect(subEdge).toBeDefined();
    });

    it('rebuilds spawn edges after modifying spawn rules', () => {
      addRole('parent');
      addRole('child');

      useConfigStore.getState().setSpawnRules('parent', ['child']);
      rebuildDerivedEdges();

      const edges = useCanvasStore.getState().edges;
      const spawnEdge = edges.find(e => e.id === 'spawn-parent-child');
      expect(spawnEdge).toBeDefined();
      expect(spawnEdge?.data?.kind).toBe('spawn');
    });

    it('removes derived edges when emission is cleared', () => {
      addRole('temp-emitter');
      addChannel('events', ['SIG']);

      useConfigStore.getState().setEmissions('temp-emitter', ['SIG']);
      rebuildDerivedEdges();
      expect(useCanvasStore.getState().edges.length).toBe(1);

      useConfigStore.getState().setEmissions('temp-emitter', []);
      rebuildDerivedEdges();
      expect(useCanvasStore.getState().edges.length).toBe(0);
    });

    it('preserves peer route edges when rebuilding derived edges', () => {
      addRole('a');
      addRole('b');

      // Add a peer route edge manually (not derived)
      useCanvasStore.getState().addEdge({
        id: 'peer-a-b-0',
        source: 'role-a',
        target: 'role-b',
        type: 'peer-route',
        data: { kind: 'peer-route', signals: [], via: 'direct' },
      });

      useConfigStore.getState().addPeerRoute({ from: 'a', to: 'b', via: 'direct' });

      // Rebuild derived edges
      rebuildDerivedEdges();

      const edges = useCanvasStore.getState().edges;
      const peerEdge = edges.find(e => e.data?.kind === 'peer-route');
      expect(peerEdge).toBeDefined();
    });

    it('updates channel node counts after rebuild', () => {
      addRole('emitter');
      addRole('listener');
      addChannel('ch', ['SIG_A']);

      useConfigStore.getState().setEmissions('emitter', ['SIG_A']);
      useConfigStore.getState().setSubscriptions('listener', [{ channel: 'ch' }]);
      rebuildDerivedEdges();

      const node = useCanvasStore.getState().nodes.find(n => n.id === 'channel-ch');
      expect((node?.data as ChannelNodeData).emitterCount).toBe(1);
      expect((node?.data as ChannelNodeData).subscriberCount).toBe(1);
    });
  });
});
