/**
 * E2E: Validation pipeline
 * Tests that validation catches errors and warnings in
 * realistic editing scenarios.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../src/stores/canvas-store';
import { useConfigStore } from '../src/stores/config-store';
import { useHistoryStore } from '../src/stores/history-store';
import { useValidationStore } from '../src/stores/validation-store';
import { BUNDLED_TEMPLATES } from '../src/lib/bundled-templates';
import { loadTemplate } from '../src/lib/load-template';
import { validate } from '../src/lib/validator';

function resetStores() {
  useCanvasStore.getState().clear();
  useConfigStore.getState().clear();
  useHistoryStore.getState().clear();
  useValidationStore.getState().clear();
}

function runValidation() {
  const config = useConfigStore.getState();
  return validate({
    team: config.team,
    roles: config.roles,
    channels: config.channels,
    subscriptions: config.subscriptions,
    emissions: config.emissions,
    peerRoutes: config.peerRoutes,
    spawnRules: config.spawnRules,
    topologyRoot: config.topologyRoot,
    topologyCompanions: config.topologyCompanions,
  });
}

describe('E2E: Validation pipeline', () => {
  beforeEach(resetStores);

  it('loaded GSD template passes validation', () => {
    const tmpl = BUNDLED_TEMPLATES['gsd'];
    loadTemplate(tmpl.manifest, tmpl.roles);

    const { errors } = runValidation();
    expect(errors.length).toBe(0);
  });

  it('empty team name produces error', () => {
    useConfigStore.getState().setTeam({ name: '' });
    useConfigStore.getState().setRole('root', {
      name: 'root',
      displayName: 'root',
      description: '',
      capabilities: [],
    });

    const { errors } = runValidation();
    expect(errors.some(e => e.path === 'team.name')).toBe(true);
  });

  it('no roles produces error', () => {
    useConfigStore.getState().setTeam({ name: 'empty' });

    const { errors } = runValidation();
    expect(errors.some(e => e.path === 'roles')).toBe(true);
  });

  it('missing topology root produces error', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('worker', {
      name: 'worker',
      displayName: 'Worker',
      description: '',
      capabilities: [],
    });
    // No topology root set

    const { errors } = runValidation();
    expect(errors.some(e => e.path === 'topology.root')).toBe(true);
  });

  it('root pointing to nonexistent role produces error', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('worker', {
      name: 'worker',
      displayName: 'Worker',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('nonexistent');

    const { errors } = runValidation();
    expect(errors.some(e => e.message.includes('nonexistent'))).toBe(true);
  });

  it('companion also being root produces error', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('dual', {
      name: 'dual',
      displayName: 'dual',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('dual');
    useConfigStore.getState().setTopologyCompanions(['dual']);

    const { errors } = runValidation();
    expect(errors.some(e => e.message.includes('both root and companion'))).toBe(true);
  });

  it('circular inheritance produces error', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('a', {
      name: 'a',
      displayName: 'A',
      description: '',
      extends: 'b',
      capabilities: [],
    });
    useConfigStore.getState().setRole('b', {
      name: 'b',
      displayName: 'B',
      description: '',
      extends: 'a',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('a');

    const { errors } = runValidation();
    expect(errors.some(e => e.message.includes('Circular inheritance'))).toBe(true);
  });

  it('subscription to nonexistent channel produces error', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('worker', {
      name: 'worker',
      displayName: 'Worker',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('worker');
    useConfigStore.getState().setSubscriptions('worker', [{ channel: 'nonexistent' }]);

    const { errors } = runValidation();
    expect(errors.some(e => e.message.includes('nonexistent'))).toBe(true);
  });

  it('peer route to nonexistent role produces error', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('alpha', {
      name: 'alpha',
      displayName: 'Alpha',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('alpha');
    useConfigStore.getState().addPeerRoute({ from: 'alpha', to: 'missing', via: 'direct' });

    const { errors } = runValidation();
    expect(errors.some(e => e.message.includes('missing'))).toBe(true);
  });

  it('spawn rule referencing nonexistent role produces error', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('parent', {
      name: 'parent',
      displayName: 'Parent',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('parent');
    useConfigStore.getState().setSpawnRules('parent', ['ghost']);

    const { errors } = runValidation();
    expect(errors.some(e => e.message.includes('ghost'))).toBe(true);
  });

  it('signal not in any channel produces warning', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('emitter', {
      name: 'emitter',
      displayName: 'Emitter',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('emitter');
    useConfigStore.getState().setEmissions('emitter', ['ORPHAN_SIGNAL']);

    const { warnings } = runValidation();
    expect(warnings.some(w => w.message.includes('ORPHAN_SIGNAL'))).toBe(true);
  });

  it('unreachable role produces warning', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('root', {
      name: 'root',
      displayName: 'Root',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setRole('island', {
      name: 'island',
      displayName: 'Island',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('root');

    const { warnings } = runValidation();
    expect(warnings.some(w => w.message.includes('island'))).toBe(true);
  });

  it('unused signal in channel produces warning', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('root', {
      name: 'root',
      displayName: 'Root',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('root');
    useConfigStore.getState().setChannel('events', { signals: ['NEVER_EMITTED'] });

    const { warnings } = runValidation();
    expect(warnings.some(w => w.message.includes('NEVER_EMITTED'))).toBe(true);
  });

  it('non-UPPER_CASE signal produces warning', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('root', {
      name: 'root',
      displayName: 'Root',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('root');
    useConfigStore.getState().setChannel('events', { signals: ['lowercaseSignal'] });

    const { warnings } = runValidation();
    expect(warnings.some(w => w.message.includes('UPPER_CASE'))).toBe(true);
  });

  it('fixing errors makes validation pass', () => {
    // Start with errors
    useConfigStore.getState().setTeam({ name: '' });
    let result = runValidation();
    expect(result.errors.length).toBeGreaterThan(0);

    // Fix: set valid team name, add a role, set root
    useConfigStore.getState().setTeam({ name: 'fixed-team' });
    useConfigStore.getState().setRole('root', {
      name: 'root',
      displayName: 'Root',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('root');

    result = runValidation();
    expect(result.errors.length).toBe(0);
  });

  it('validation errors include nodeId for node-specific issues', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('a', {
      name: 'a',
      displayName: 'A',
      description: '',
      extends: 'nonexistent',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('a');

    const { errors } = runValidation();
    const extendsError = errors.find(e => e.path.includes('extends'));
    expect(extendsError?.nodeId).toBe('role-a');
  });

  it('removing a role referenced by others cascades validation errors', () => {
    useConfigStore.getState().setTeam({ name: 'test' });
    useConfigStore.getState().setRole('parent', {
      name: 'parent',
      displayName: 'Parent',
      description: '',
      capabilities: [],
    });
    useConfigStore.getState().setRole('child', {
      name: 'child',
      displayName: 'Child',
      description: '',
      extends: 'parent',
      capabilities: [],
    });
    useConfigStore.getState().setTopologyRoot('parent');

    // Valid at first
    let result = runValidation();
    expect(result.errors.length).toBe(0);

    // Remove parent (but keep topology root pointing to it)
    useConfigStore.getState().removeRole('parent');

    result = runValidation();
    // Should have errors: root references nonexistent role, child extends nonexistent role
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
