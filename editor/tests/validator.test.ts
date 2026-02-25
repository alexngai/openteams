import { describe, it, expect } from 'vitest';
import { validate } from '../src/lib/validator';

function makeInput(overrides: Record<string, any> = {}) {
  return {
    team: { name: 'test-team', description: '', version: 1 as const, enforcement: 'permissive' as const, extensions: {} },
    roles: new Map([
      ['leader', { name: 'leader', displayName: 'Leader', description: '', capabilities: [] }],
      ['worker', { name: 'worker', displayName: 'Worker', description: '', capabilities: [] }],
    ]),
    channels: {
      events: { signals: ['TASK_DONE', 'TASK_FAILED'] },
    },
    subscriptions: {
      leader: [{ channel: 'events' }],
    },
    emissions: {
      worker: ['TASK_DONE'],
    },
    peerRoutes: [],
    spawnRules: { leader: ['worker'] },
    topologyRoot: 'leader',
    topologyCompanions: [],
    ...overrides,
  };
}

describe('validate', () => {
  it('accepts a valid config', () => {
    const { errors, warnings } = validate(makeInput());
    expect(errors).toHaveLength(0);
  });

  it('errors when team name is empty', () => {
    const { errors } = validate(makeInput({
      team: { name: '', description: '', version: 1, enforcement: 'permissive', extensions: {} },
    }));
    expect(errors.some(e => e.path === 'team.name')).toBe(true);
  });

  it('errors when no root is set', () => {
    const { errors } = validate(makeInput({ topologyRoot: '' }));
    expect(errors.some(e => e.path === 'topology.root')).toBe(true);
  });

  it('errors when root references unknown role', () => {
    const { errors } = validate(makeInput({ topologyRoot: 'nonexistent' }));
    expect(errors.some(e => e.message.includes('nonexistent'))).toBe(true);
  });

  it('errors when a role is both root and companion', () => {
    const { errors } = validate(makeInput({ topologyCompanions: ['leader'] }));
    expect(errors.some(e => e.message.includes('both root and companion'))).toBe(true);
  });

  it('errors when subscription references unknown channel', () => {
    const { errors } = validate(makeInput({
      subscriptions: { leader: [{ channel: 'nonexistent' }] },
    }));
    expect(errors.some(e => e.message.includes('unknown channel'))).toBe(true);
  });

  it('errors when subscription signal filter references invalid signal', () => {
    const { errors } = validate(makeInput({
      subscriptions: { leader: [{ channel: 'events', signals: ['BOGUS'] }] },
    }));
    expect(errors.some(e => e.message.includes('BOGUS'))).toBe(true);
  });

  it('errors on circular inheritance', () => {
    const roles = new Map([
      ['a', { name: 'a', displayName: 'A', description: '', capabilities: [], extends: 'b' }],
      ['b', { name: 'b', displayName: 'B', description: '', capabilities: [], extends: 'a' }],
    ]);
    const { errors } = validate(makeInput({ roles, topologyRoot: 'a' }));
    expect(errors.some(e => e.message.includes('Circular inheritance'))).toBe(true);
  });

  it('warns on signals not emitted by any role', () => {
    const { warnings } = validate(makeInput({
      emissions: {}, // no emissions at all
    }));
    expect(warnings.some(w => w.message.includes('never emitted'))).toBe(true);
  });

  it('warns on emission signal not in any channel', () => {
    const { warnings } = validate(makeInput({
      emissions: { worker: ['UNKNOWN_SIGNAL'] },
    }));
    expect(warnings.some(w => w.message.includes('not defined in any channel'))).toBe(true);
  });
});
