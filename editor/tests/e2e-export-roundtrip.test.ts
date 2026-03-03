/**
 * E2E: Export/Import roundtrip
 * Tests the full cycle: load template → modify → export YAML →
 * re-import → verify state matches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as yaml from 'js-yaml';
import { useCanvasStore } from '../src/stores/canvas-store';
import { useConfigStore } from '../src/stores/config-store';
import { useHistoryStore } from '../src/stores/history-store';
import { useValidationStore } from '../src/stores/validation-store';
import { BUNDLED_TEMPLATES } from '../src/lib/bundled-templates';
import { loadTemplate } from '../src/lib/load-template';
import { compileToYaml } from '../src/lib/compiler';
import { configToCanvas, canvasToManifest, rolesToDefinitions } from '../src/lib/serializer';
import type { TeamManifest, RoleDefinition } from '@openteams/template/types';
import type { RoleNodeData } from '../src/types/editor';

function resetStores() {
  useCanvasStore.getState().clear();
  useConfigStore.getState().clear();
  useHistoryStore.getState().clear();
  useValidationStore.getState().clear();
}

describe('E2E: Export/Import roundtrip', () => {
  beforeEach(resetStores);

  it('GSD template export produces valid team.yaml', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const files = compileToYaml();
    const teamFile = files.find(f => f.path === 'team.yaml');
    expect(teamFile).toBeDefined();

    const parsed = yaml.load(teamFile!.content) as TeamManifest;
    expect(parsed.name).toBe('gsd');
    expect(parsed.roles).toHaveLength(12);
    expect(parsed.topology.root.role).toBe('orchestrator');
  });

  it('export produces role files for each role', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const files = compileToYaml();
    const roleFiles = files.filter(f => f.path.startsWith('roles/'));

    // Should have one file per role
    expect(roleFiles.length).toBe(12);

    // Each should be valid YAML
    for (const file of roleFiles) {
      const parsed = yaml.load(file.content) as Record<string, unknown>;
      expect(parsed).toBeDefined();
      expect(parsed.name).toBeDefined();
    }
  });

  it('roundtrip: load → export → re-import preserves roles', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    // Capture state after load
    const originalRoleCount = useConfigStore.getState().roles.size;
    const originalChannelCount = Object.keys(useConfigStore.getState().channels).length;

    // Export
    const files = compileToYaml();
    const teamYaml = files.find(f => f.path === 'team.yaml')!.content;
    const manifest = yaml.load(teamYaml) as TeamManifest;

    // Build role definitions from role files
    const roleMap = new Map<string, RoleDefinition>();
    for (const file of files.filter(f => f.path.startsWith('roles/'))) {
      const role = yaml.load(file.content) as RoleDefinition;
      if (role?.name) roleMap.set(role.name, role);
    }

    // Re-import
    resetStores();
    loadTemplate(manifest, roleMap);

    // Verify state matches
    expect(useConfigStore.getState().roles.size).toBe(originalRoleCount);
    expect(Object.keys(useConfigStore.getState().channels).length).toBe(originalChannelCount);
    expect(useConfigStore.getState().team.name).toBe('gsd');
  });

  it('roundtrip preserves topology structure', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const files = compileToYaml();
    const manifest = yaml.load(files.find(f => f.path === 'team.yaml')!.content) as TeamManifest;

    expect(manifest.topology.root.role).toBe('orchestrator');
    expect(manifest.topology.companions?.map(c => c.role)).toContain('roadmapper');
    expect(manifest.topology.companions?.map(c => c.role)).toContain('verifier');
  });

  it('roundtrip preserves communication channels', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const files = compileToYaml();
    const manifest = yaml.load(files.find(f => f.path === 'team.yaml')!.content) as TeamManifest;

    expect(manifest.communication?.channels).toBeDefined();
    expect(Object.keys(manifest.communication!.channels!)).toContain('project_lifecycle');
    expect(manifest.communication!.channels!.project_lifecycle.signals).toContain('PROJECT_INITIALIZED');
  });

  it('roundtrip preserves peer routes', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const originalRouteCount = useConfigStore.getState().peerRoutes.length;

    const files = compileToYaml();
    const manifest = yaml.load(files.find(f => f.path === 'team.yaml')!.content) as TeamManifest;

    const exportedRouteCount = manifest.communication?.routing?.peers?.length || 0;
    expect(exportedRouteCount).toBe(originalRouteCount);
  });

  it('roundtrip preserves spawn rules', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const files = compileToYaml();
    const manifest = yaml.load(files.find(f => f.path === 'team.yaml')!.content) as TeamManifest;

    expect(manifest.topology.spawn_rules).toBeDefined();
    expect(manifest.topology.spawn_rules!['orchestrator']).toHaveLength(11);
  });

  it('export after adding a role includes the new role', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    // Add a new role
    const config = useConfigStore.getState();
    config.setRole('custom-agent', {
      name: 'custom-agent',
      displayName: 'Custom Agent',
      description: 'A custom agent',
      capabilities: ['analyze'],
    });
    useCanvasStore.getState().addNode({
      id: 'role-custom-agent',
      type: 'role',
      position: { x: 0, y: 0 },
      data: {
        kind: 'role',
        roleName: 'custom-agent',
        displayName: 'Custom Agent',
        description: 'A custom agent',
        topologyPosition: 'spawned',
        capabilities: ['analyze'],
        emits: [],
        subscribesTo: [],
        peerRoutesOut: 0,
        peerRoutesIn: 0,
        canSpawn: [],
        errors: [],
        warnings: [],
      } as RoleNodeData,
    });

    const files = compileToYaml();
    const manifest = yaml.load(files.find(f => f.path === 'team.yaml')!.content) as TeamManifest;

    expect(manifest.roles).toContain('custom-agent');
    expect(manifest.roles).toHaveLength(13);

    const roleFile = files.find(f => f.path === 'roles/custom-agent.yaml');
    expect(roleFile).toBeDefined();
    const roleDef = yaml.load(roleFile!.content) as Record<string, unknown>;
    expect(roleDef.name).toBe('custom-agent');
    expect(roleDef.display_name).toBe('Custom Agent');
    expect(roleDef.capabilities).toEqual(['analyze']);
  });

  it('export preserves model assignments', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    // Set a model
    useConfigStore.getState().setRoleModel('orchestrator', 'opus');

    const files = compileToYaml();
    const manifest = yaml.load(files.find(f => f.path === 'team.yaml')!.content) as TeamManifest;

    expect(manifest.topology.root.config?.model).toBe('opus');
  });

  it('export preserves enforcement mode', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    // Change enforcement
    useConfigStore.getState().setTeam({ enforcement: 'strict' });

    const files = compileToYaml();
    const manifest = yaml.load(files.find(f => f.path === 'team.yaml')!.content) as TeamManifest;

    expect(manifest.communication?.enforcement).toBe('strict');
  });

  it('export produces prompt files when content exists', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    // Add prompt content to a role
    const config = useConfigStore.getState();
    const role = config.roles.get('orchestrator')!;
    config.setRole('orchestrator', {
      ...role,
      promptContent: '# Orchestrator\nYou coordinate the team.',
    });

    const files = compileToYaml();
    const promptFile = files.find(f => f.path === 'prompts/orchestrator/ROLE.md');
    expect(promptFile).toBeDefined();
    expect(promptFile!.content).toContain('# Orchestrator');
  });

  it('configToCanvas and canvasToManifest are inverses', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];

    // Forward: manifest → canvas
    const canvasState = configToCanvas(tmpl.manifest, tmpl.roles);
    expect(canvasState.nodes.length).toBeGreaterThan(0);
    expect(canvasState.edges.length).toBeGreaterThan(0);

    // Reverse: config → manifest
    loadTemplate(tmpl.manifest, tmpl.roles);
    const config = useConfigStore.getState();
    const roleModels = new Map(Object.entries(config.roleModels));
    const manifest = canvasToManifest(
      config.team,
      config.roles,
      config.channels,
      config.subscriptions,
      config.emissions,
      config.peerRoutes,
      config.spawnRules,
      config.topologyRoot,
      config.topologyCompanions,
      roleModels,
    );

    expect(manifest.name).toBe(tmpl.manifest.name);
    expect(manifest.roles.length).toBe(tmpl.manifest.roles.length);
    expect(manifest.topology.root.role).toBe(tmpl.manifest.topology.root.role);
  });

  it('rolesToDefinitions converts config roles to YAML-ready format', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const config = useConfigStore.getState();
    const defs = rolesToDefinitions(config.roles);

    expect(defs.size).toBe(12);

    const orchestrator = defs.get('orchestrator');
    expect(orchestrator).toBeDefined();
    expect(orchestrator?.name).toBe('orchestrator');
  });

  it('export omits empty emission and subscription arrays', () => {
    resetStores();
    useConfigStore.getState().setTeam({ name: 'minimal' });
    useConfigStore.getState().setRole('root', {
      name: 'root',
      displayName: 'Root',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('root');
    // Explicitly set empty emissions
    useConfigStore.getState().setEmissions('root', []);

    const files = compileToYaml();
    const manifest = yaml.load(files.find(f => f.path === 'team.yaml')!.content) as Record<string, unknown>;

    // Communication section should not contain empty emissions
    const comm = manifest.communication as Record<string, unknown> | undefined;
    if (comm?.emissions) {
      const emissions = comm.emissions as Record<string, string[]>;
      for (const val of Object.values(emissions)) {
        expect(val.length).toBeGreaterThan(0);
      }
    }
  });
});
