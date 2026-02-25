import type { ValidationIssue } from '../stores/validation-store';
import type { EditorTeamConfig, EditorRoleConfig } from '../stores/config-store';
import type { ChannelDefinition, SubscriptionEntry, PeerRoute } from '@openteams/template/types';

interface ValidationInput {
  team: EditorTeamConfig;
  roles: Map<string, EditorRoleConfig>;
  channels: Record<string, ChannelDefinition>;
  subscriptions: Record<string, SubscriptionEntry[]>;
  emissions: Record<string, string[]>;
  peerRoutes: PeerRoute[];
  spawnRules: Record<string, string[]>;
  topologyRoot: string;
  topologyCompanions: string[];
}

const ROLE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const SIGNAL_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export function validate(input: ValidationInput): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const roleNames = new Set(input.roles.keys());

  // Layer 1: Schema basics
  if (!input.team.name) {
    errors.push({ path: 'team.name', message: 'Team name is required', severity: 'error' });
  } else if (!ROLE_NAME_RE.test(input.team.name)) {
    errors.push({ path: 'team.name', message: 'Team name must match ^[a-zA-Z0-9][a-zA-Z0-9_-]*$', severity: 'error' });
  }

  if (roleNames.size === 0) {
    errors.push({ path: 'roles', message: 'At least one role is required', severity: 'error' });
  }

  for (const name of roleNames) {
    if (!ROLE_NAME_RE.test(name)) {
      errors.push({ path: `roles.${name}`, message: `Role name "${name}" is invalid`, severity: 'error', nodeId: `role-${name}` });
    }
  }

  // Validate signal names in channels
  for (const [chName, ch] of Object.entries(input.channels)) {
    for (const sig of ch.signals) {
      if (!SIGNAL_NAME_RE.test(sig)) {
        warnings.push({ path: `channels.${chName}.signals`, message: `Signal "${sig}" should be UPPER_CASE`, severity: 'warning', nodeId: `channel-${chName}` });
      }
    }
  }

  // Layer 2: Topology integrity
  if (!input.topologyRoot) {
    errors.push({ path: 'topology.root', message: 'A root role must be specified', severity: 'error' });
  } else if (!roleNames.has(input.topologyRoot)) {
    errors.push({ path: 'topology.root', message: `Root role "${input.topologyRoot}" is not in the roles list`, severity: 'error' });
  }

  for (const comp of input.topologyCompanions) {
    if (!roleNames.has(comp)) {
      errors.push({ path: 'topology.companions', message: `Companion role "${comp}" is not in the roles list`, severity: 'error' });
    }
    if (comp === input.topologyRoot) {
      errors.push({ path: 'topology.companions', message: `"${comp}" cannot be both root and companion`, severity: 'error', nodeId: `role-${comp}` });
    }
  }

  // Spawn rules: referenced roles exist
  for (const [fromRole, targets] of Object.entries(input.spawnRules)) {
    if (!roleNames.has(fromRole)) {
      errors.push({ path: `spawn_rules.${fromRole}`, message: `Spawn rule references unknown role "${fromRole}"`, severity: 'error' });
    }
    for (const target of targets) {
      if (!roleNames.has(target)) {
        errors.push({ path: `spawn_rules.${fromRole}`, message: `Spawn target "${target}" is not in the roles list`, severity: 'error' });
      }
    }
  }

  // Layer 3: Communication integrity
  const allChannelSignals = new Set<string>();
  for (const ch of Object.values(input.channels)) {
    for (const sig of ch.signals) allChannelSignals.add(sig);
  }

  // Emissions: signals must exist in channels
  for (const [role, signals] of Object.entries(input.emissions)) {
    if (!roleNames.has(role)) {
      errors.push({ path: `emissions.${role}`, message: `Emission role "${role}" is not in the roles list`, severity: 'error' });
    }
    for (const sig of signals) {
      if (!allChannelSignals.has(sig)) {
        warnings.push({ path: `emissions.${role}`, message: `Signal "${sig}" is not defined in any channel`, severity: 'warning', nodeId: `role-${role}` });
      }
    }
  }

  // Subscriptions: channels must exist, signal filters must be valid
  for (const [role, subs] of Object.entries(input.subscriptions)) {
    if (!roleNames.has(role)) {
      errors.push({ path: `subscriptions.${role}`, message: `Subscription role "${role}" is not in the roles list`, severity: 'error' });
    }
    for (const sub of subs) {
      if (!input.channels[sub.channel]) {
        errors.push({ path: `subscriptions.${role}`, message: `Subscription references unknown channel "${sub.channel}"`, severity: 'error', nodeId: `role-${role}` });
      } else if (sub.signals) {
        const chSignals = input.channels[sub.channel].signals;
        for (const sig of sub.signals) {
          if (!chSignals.includes(sig)) {
            errors.push({ path: `subscriptions.${role}`, message: `Signal filter "${sig}" not in channel "${sub.channel}"`, severity: 'error', nodeId: `role-${role}` });
          }
        }
      }
    }
  }

  // Peer routes: roles must exist
  for (const route of input.peerRoutes) {
    if (!roleNames.has(route.from)) {
      errors.push({ path: 'routing.peers', message: `Peer route from "${route.from}" references unknown role`, severity: 'error' });
    }
    if (!roleNames.has(route.to)) {
      errors.push({ path: 'routing.peers', message: `Peer route to "${route.to}" references unknown role`, severity: 'error' });
    }
  }

  // Layer 4: Inheritance integrity
  for (const [name, role] of input.roles) {
    if (role.extends) {
      if (!roleNames.has(role.extends)) {
        errors.push({ path: `roles.${name}.extends`, message: `Parent role "${role.extends}" does not exist`, severity: 'error', nodeId: `role-${name}` });
      } else {
        // Check for circular inheritance
        const visited = new Set<string>();
        let current: string | undefined = role.extends;
        while (current) {
          if (visited.has(current)) {
            errors.push({ path: `roles.${name}.extends`, message: `Circular inheritance detected: ${name} -> ${Array.from(visited).join(' -> ')} -> ${current}`, severity: 'error', nodeId: `role-${name}` });
            break;
          }
          visited.add(current);
          current = input.roles.get(current)?.extends;
        }
      }
    }
  }

  // Layer 5: Semantic warnings
  // Unreachable roles (no subscriptions, no incoming peer routes, not root/companion, no spawn path)
  for (const name of roleNames) {
    const hasSubs = (input.subscriptions[name] || []).length > 0;
    const hasIncomingPeer = input.peerRoutes.some(r => r.to === name);
    const isRoot = name === input.topologyRoot;
    const isCompanion = input.topologyCompanions.includes(name);
    const isSpawnable = Object.values(input.spawnRules).some(targets => targets.includes(name));

    if (!hasSubs && !hasIncomingPeer && !isRoot && !isCompanion && !isSpawnable) {
      warnings.push({ path: `roles.${name}`, message: `Role "${name}" has no subscriptions, incoming routes, or spawn paths`, severity: 'warning', nodeId: `role-${name}` });
    }
  }

  // Unused signals (defined in channel but never emitted or subscribed)
  for (const [chName, ch] of Object.entries(input.channels)) {
    for (const sig of ch.signals) {
      const isEmitted = Object.values(input.emissions).some(sigs => sigs.includes(sig));
      if (!isEmitted) {
        warnings.push({ path: `channels.${chName}`, message: `Signal "${sig}" is never emitted`, severity: 'warning', nodeId: `channel-${chName}` });
      }
    }
  }

  return { errors, warnings };
}
