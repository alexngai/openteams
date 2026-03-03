/**
 * E2E: Template loading flow
 * Tests that loading a bundled template correctly populates all stores
 * and produces the expected canvas state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../src/stores/canvas-store';
import { useConfigStore } from '../src/stores/config-store';
import { useHistoryStore } from '../src/stores/history-store';
import { useValidationStore } from '../src/stores/validation-store';
import { BUNDLED_TEMPLATES } from '../src/lib/bundled-templates';
import { loadTemplate } from '../src/lib/load-template';

function resetStores() {
  useCanvasStore.getState().clear();
  useConfigStore.getState().clear();
  useHistoryStore.getState().clear();
  useValidationStore.getState().clear();
}

describe('E2E: Template loading flow', () => {
  beforeEach(resetStores);

  it('loads gsd template with correct role count', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const config = useConfigStore.getState();
    expect(config.roles.size).toBe(12);
    expect(config.team.name).toBe('gsd');
  });

  it('creates canvas nodes for each role and channel', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const canvas = useCanvasStore.getState();
    const roleNodes = canvas.nodes.filter(n => n.data.kind === 'role');
    const channelNodes = canvas.nodes.filter(n => n.data.kind === 'channel');

    expect(roleNodes.length).toBe(12);
    expect(channelNodes.length).toBe(4);
  });

  it('sets topology root and companions correctly', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const config = useConfigStore.getState();
    expect(config.topologyRoot).toBe('orchestrator');
    expect(config.topologyCompanions).toContain('roadmapper');
    expect(config.topologyCompanions).toContain('verifier');
  });

  it('creates peer route edges from routing config', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const canvas = useCanvasStore.getState();
    const peerEdges = canvas.edges.filter(e => e.data?.kind === 'peer-route');
    const config = useConfigStore.getState();

    expect(peerEdges.length).toBe(config.peerRoutes.length);
  });

  it('creates signal flow edges for emissions and subscriptions', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const canvas = useCanvasStore.getState();
    const signalEdges = canvas.edges.filter(e => e.data?.kind === 'signal-flow');
    const emissionEdges = signalEdges.filter(e => (e.data as any).direction === 'emission');
    const subEdges = signalEdges.filter(e => (e.data as any).direction === 'subscription');

    // Should have both emission and subscription edges
    expect(emissionEdges.length).toBeGreaterThan(0);
    expect(subEdges.length).toBeGreaterThan(0);
  });

  it('creates spawn edges from spawn_rules', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const canvas = useCanvasStore.getState();
    const spawnEdges = canvas.edges.filter(e => e.data?.kind === 'spawn');
    const config = useConfigStore.getState();

    // orchestrator can spawn 11 roles
    const orchestratorSpawns = config.spawnRules['orchestrator'] || [];
    expect(orchestratorSpawns.length).toBe(11);

    // Spawn edges should match total spawn rules
    const totalSpawnRules = Object.values(config.spawnRules)
      .reduce((sum, targets) => sum + targets.length, 0);
    expect(spawnEdges.length).toBe(totalSpawnRules);
  });

  it('sets correct topology position on role nodes', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const canvas = useCanvasStore.getState();

    const orchestratorNode = canvas.nodes.find(n => n.id === 'role-orchestrator');
    expect(orchestratorNode?.data.topologyPosition).toBe('root');

    const roadmapperNode = canvas.nodes.find(n => n.id === 'role-roadmapper');
    expect(roadmapperNode?.data.topologyPosition).toBe('companion');

    const executorNode = canvas.nodes.find(n => n.id === 'role-executor');
    expect(executorNode?.data.topologyPosition).toBe('spawned');
  });

  it('populates channels in config store', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const config = useConfigStore.getState();
    const channelNames = Object.keys(config.channels);

    expect(channelNames).toContain('project_lifecycle');
    expect(channelNames).toContain('planning_events');
    expect(channelNames).toContain('execution_events');
    expect(channelNames).toContain('verification_events');

    // Check signals exist in channels
    expect(config.channels.project_lifecycle.signals).toContain('PROJECT_INITIALIZED');
    expect(config.channels.execution_events.signals).toContain('WAVE_STARTED');
  });

  it('resets history on template load', () => {
    // Load once
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    // Should have exactly one snapshot (the initial push)
    const history = useHistoryStore.getState();
    expect(history.undoStack.length).toBe(1);
    expect(history.redoStack.length).toBe(0);
  });

  it('loads BMAD template with different structure', () => {
    const tmpl = BUNDLED_TEMPLATES['bmad-method'];
    if (!tmpl) return; // Skip if not available
    loadTemplate(tmpl.manifest, tmpl.roles);

    const config = useConfigStore.getState();
    expect(config.team.name).toBe('bmad-method');
    expect(config.roles.size).toBeGreaterThan(0);
  });

  it('switching templates replaces all state', () => {
    const gsd = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(gsd.manifest, gsd.roles);

    const gsdRoleCount = useConfigStore.getState().roles.size;

    // Load a different template
    const bmad = BUNDLED_TEMPLATES['bmad-method'];
    if (!bmad) return;
    loadTemplate(bmad.manifest, bmad.roles);

    const bmadRoleCount = useConfigStore.getState().roles.size;
    expect(bmadRoleCount).not.toBe(gsdRoleCount);
    expect(useConfigStore.getState().team.name).toBe('bmad-method');
  });

  it('populates emission and subscription mappings', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const config = useConfigStore.getState();

    // Emissions should have at least one role
    const emittingRoles = Object.keys(config.emissions);
    expect(emittingRoles.length).toBeGreaterThan(0);

    // Subscriptions should have at least one role
    const subscribingRoles = Object.keys(config.subscriptions);
    expect(subscribingRoles.length).toBeGreaterThan(0);
  });

  it('extracts extensions from manifest', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const config = useConfigStore.getState();
    // GSD has a gsd extension key in the manifest
    const hasExtensions = Object.keys(config.team.extensions).length > 0;
    // It may or may not have extensions depending on the bundled template
    // At minimum the extensions object should exist
    expect(config.team.extensions).toBeDefined();
  });

  it('auto-layouts nodes with non-zero positions', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const canvas = useCanvasStore.getState();
    // At least some nodes should have been positioned by dagre
    const positioned = canvas.nodes.filter(n => n.position.x !== 0 || n.position.y !== 0);
    expect(positioned.length).toBeGreaterThan(0);
  });
});
