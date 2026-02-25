import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigStore } from '../src/stores/config-store';
import { useCanvasStore } from '../src/stores/canvas-store';
import { compileToYaml } from '../src/lib/compiler';
import { BUNDLED_TEMPLATES } from '../src/lib/bundled-templates';
import { configToCanvas } from '../src/lib/serializer';
import * as yaml from 'js-yaml';

function loadGSD() {
  const { manifest, roles: roleDefinitions } = BUNDLED_TEMPLATES['get-shit-done'];
  const comm = manifest.communication || {};

  const roles = new Map<string, any>();
  for (const roleName of manifest.roles) {
    const roleDef = roleDefinitions.get(roleName);
    roles.set(roleName, {
      name: roleName,
      displayName: roleDef?.display_name || roleName,
      description: roleDef?.description || '',
      extends: roleDef?.extends,
      capabilities: Array.isArray(roleDef?.capabilities) ? roleDef.capabilities : [],
    });
  }

  const roleModels: Record<string, string> = {};
  if (manifest.topology.root.config?.model) {
    roleModels[manifest.topology.root.role] = manifest.topology.root.config.model;
  }

  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!['name', 'description', 'version', 'roles', 'topology', 'communication'].includes(key)) {
      extensions[key] = value;
    }
  }

  useConfigStore.getState().loadFromManifest(
    {
      name: manifest.name,
      description: manifest.description || '',
      version: 1,
      enforcement: (comm.enforcement as any) || 'permissive',
      extensions,
    },
    roles,
    comm.channels || {},
    comm.subscriptions || {},
    comm.emissions || {},
    comm.routing?.peers || [],
    manifest.topology.spawn_rules || {},
    roleModels,
    manifest.topology.root.role,
    (manifest.topology.companions || []).map(c => c.role),
  );

  const canvasState = configToCanvas(manifest, roleDefinitions);
  useCanvasStore.getState().setNodes(canvasState.nodes);
  useCanvasStore.getState().setEdges(canvasState.edges);
}

describe('compileToYaml', () => {
  beforeEach(() => {
    useConfigStore.getState().clear();
    useCanvasStore.getState().clear();
  });

  it('produces team.yaml with correct structure', () => {
    loadGSD();
    const files = compileToYaml();

    const teamFile = files.find(f => f.path === 'team.yaml');
    expect(teamFile).toBeDefined();

    const parsed = yaml.load(teamFile!.content) as any;
    expect(parsed.name).toBe('get-shit-done');
    expect(parsed.roles).toHaveLength(12);
    expect(parsed.topology.root.role).toBe('orchestrator');
    expect(parsed.topology.companions).toHaveLength(2);
    expect(parsed.communication).toBeDefined();
    expect(Object.keys(parsed.communication.channels)).toHaveLength(4);
    expect(parsed.communication.routing.peers).toHaveLength(5);
  });

  it('produces role YAML files for each role', () => {
    loadGSD();
    const files = compileToYaml();

    const roleFiles = files.filter(f => f.path.startsWith('roles/'));
    expect(roleFiles).toHaveLength(12);

    const orchestratorFile = roleFiles.find(f => f.path === 'roles/orchestrator.yaml');
    expect(orchestratorFile).toBeDefined();

    const parsed = yaml.load(orchestratorFile!.content) as any;
    expect(parsed.name).toBe('orchestrator');
    expect(parsed.display_name).toBe('GSD Orchestrator');
    expect(parsed.capabilities).toContain('command-routing');
  });

  it('includes extension fields in team.yaml', () => {
    loadGSD();
    const files = compileToYaml();

    const teamFile = files.find(f => f.path === 'team.yaml');
    const parsed = yaml.load(teamFile!.content) as any;
    expect(parsed.gsd).toBeDefined();
    expect(parsed.gsd.execution_model.type).toBe('wave-based-parallel');
  });

  it('omits empty subscription/emission entries', () => {
    loadGSD();
    const files = compileToYaml();

    const teamFile = files.find(f => f.path === 'team.yaml');
    const parsed = yaml.load(teamFile!.content) as any;

    // All subscription entries should have at least one subscription
    for (const [role, subs] of Object.entries(parsed.communication.subscriptions || {})) {
      expect((subs as any[]).length).toBeGreaterThan(0);
    }

    // All emission entries should have at least one signal
    for (const [role, sigs] of Object.entries(parsed.communication.emissions || {})) {
      expect((sigs as string[]).length).toBeGreaterThan(0);
    }
  });

  it('produces prompt files when content exists', () => {
    loadGSD();

    // Add prompt content to a role
    const config = useConfigStore.getState();
    const role = config.roles.get('orchestrator');
    if (role) {
      config.setRole('orchestrator', {
        ...role,
        promptContent: '# Orchestrator\n\nYou are the orchestrator.',
        additionalPrompts: [{ name: 'SOUL.md', content: '# Soul\n\nBe kind.' }],
      });
    }

    const files = compileToYaml();
    const promptFile = files.find(f => f.path === 'prompts/orchestrator/ROLE.md');
    expect(promptFile).toBeDefined();
    expect(promptFile!.content).toContain('# Orchestrator');

    const soulFile = files.find(f => f.path === 'prompts/orchestrator/SOUL.md');
    expect(soulFile).toBeDefined();
    expect(soulFile!.content).toContain('# Soul');
  });
});
