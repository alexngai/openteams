import { describe, it, expect } from 'vitest';
import { configToCanvas, canvasToManifest, rolesToDefinitions } from '../src/lib/serializer';
import { BUNDLED_TEMPLATES } from '../src/lib/bundled-templates';

describe('configToCanvas', () => {
  it('converts gsd template to canvas state', () => {
    const { manifest, roles } = BUNDLED_TEMPLATES['gsd'];
    const state = configToCanvas(manifest, roles);

    // 12 role nodes + 4 channel nodes = 16
    const roleNodes = state.nodes.filter(n => n.data.kind === 'role');
    const channelNodes = state.nodes.filter(n => n.data.kind === 'channel');
    expect(roleNodes).toHaveLength(12);
    expect(channelNodes).toHaveLength(4);

    // Check root node
    const root = roleNodes.find(n => n.data.kind === 'role' && n.data.roleName === 'orchestrator');
    expect(root).toBeDefined();
    if (root?.data.kind === 'role') {
      expect(root.data.topologyPosition).toBe('root');
      expect(root.data.emits).toContain('PROJECT_INITIALIZED');
      expect(root.data.subscribesTo).toHaveLength(4);
    }

    // Check edge counts
    const peerEdges = state.edges.filter(e => e.data?.kind === 'peer-route');
    const signalEdges = state.edges.filter(e => e.data?.kind === 'signal-flow');
    const spawnEdges = state.edges.filter(e => e.data?.kind === 'spawn');

    expect(peerEdges).toHaveLength(5); // 5 peer routes in GSD
    expect(spawnEdges).toHaveLength(11); // orchestrator spawns 11 roles

    // Signal flow: emissions + subscriptions as edges
    expect(signalEdges.length).toBeGreaterThan(0);

    // All nodes have positions (from auto-layout)
    for (const node of state.nodes) {
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
    }
  });

  it('converts bmad-method template to canvas state', () => {
    const { manifest, roles } = BUNDLED_TEMPLATES['bmad-method'];
    const state = configToCanvas(manifest, roles);

    const roleNodes = state.nodes.filter(n => n.data.kind === 'role');
    const channelNodes = state.nodes.filter(n => n.data.kind === 'channel');
    expect(roleNodes).toHaveLength(10);
    expect(channelNodes).toHaveLength(4);

    // Check master is root
    const master = roleNodes.find(n => n.data.kind === 'role' && n.data.roleName === 'master');
    expect(master).toBeDefined();
    if (master?.data.kind === 'role') {
      expect(master.data.topologyPosition).toBe('root');
    }

    // Check companions
    const companions = roleNodes.filter(n => n.data.kind === 'role' && n.data.topologyPosition === 'companion');
    expect(companions).toHaveLength(5); // analyst, pm, ux-designer, architect, scrum-master

    // Peer routes
    const peerEdges = state.edges.filter(e => e.data?.kind === 'peer-route');
    expect(peerEdges).toHaveLength(7);
  });
});

describe('canvasToManifest round-trip', () => {
  it('round-trips gsd through canvas and back', () => {
    const { manifest: original, roles: originalRoles } = BUNDLED_TEMPLATES['gsd'];
    const state = configToCanvas(original, originalRoles);

    // Extract config from canvas state (simulate what the editor stores would hold)
    const roleNodes = state.nodes.filter(n => n.data.kind === 'role');
    const rolesMap = new Map<string, any>();
    const roleModels = new Map<string, string>();

    for (const node of roleNodes) {
      if (node.data.kind !== 'role') continue;
      const d = node.data;
      rolesMap.set(d.roleName, {
        name: d.roleName,
        displayName: d.displayName,
        description: d.description,
        capabilities: d.capabilities,
        extends: d.extends,
      });
      if (d.model) roleModels.set(d.roleName, d.model);
    }

    const rebuilt = canvasToManifest(
      {
        name: original.name,
        description: original.description || '',
        version: 1,
        enforcement: (original.communication?.enforcement as any) || 'permissive',
        extensions: { gsd: (original as any).gsd },
      },
      rolesMap,
      original.communication?.channels || {},
      original.communication?.subscriptions || {},
      original.communication?.emissions || {},
      original.communication?.routing?.peers || [],
      original.topology.spawn_rules || {},
      original.topology.root.role,
      (original.topology.companions || []).map(c => c.role),
      roleModels,
    );

    // Verify key fields match
    expect(rebuilt.name).toBe(original.name);
    expect(rebuilt.roles).toEqual(expect.arrayContaining(original.roles));
    expect(rebuilt.roles).toHaveLength(original.roles.length);
    expect(rebuilt.topology.root.role).toBe('orchestrator');
    expect(rebuilt.topology.companions).toHaveLength(2);
    expect(rebuilt.communication?.channels).toBeDefined();
    expect(Object.keys(rebuilt.communication?.channels || {})).toHaveLength(4);
    expect(rebuilt.communication?.routing?.peers).toHaveLength(5);
  });
});

describe('rolesToDefinitions', () => {
  it('converts editor role configs to role definitions', () => {
    const roles = new Map([
      ['test-role', {
        name: 'test-role',
        displayName: 'Test Role',
        description: 'A test role',
        capabilities: ['cap-a', 'cap-b'],
      }],
    ]);

    const defs = rolesToDefinitions(roles);
    const def = defs.get('test-role');
    expect(def).toBeDefined();
    expect(def?.name).toBe('test-role');
    expect(def?.display_name).toBe('Test Role');
    expect(def?.description).toBe('A test role');
    expect(def?.capabilities).toEqual(['cap-a', 'cap-b']);
  });
});
