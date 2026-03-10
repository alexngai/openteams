import type { FederationBridge } from '@openteams/template/types';
import type { FederationTeamEntry } from '../stores/federation-store';

export interface FederationValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export function validateFederation(
  teams: Map<string, FederationTeamEntry>,
  bridges: FederationBridge[],
): { errors: FederationValidationIssue[]; warnings: FederationValidationIssue[] } {
  const errors: FederationValidationIssue[] = [];
  const warnings: FederationValidationIssue[] = [];
  const teamKeys = new Set(teams.keys());

  // Validate bridges
  for (const bridge of bridges) {
    // Source team must exist
    if (!teamKeys.has(bridge.from.team)) {
      errors.push({
        path: 'bridges',
        message: `Bridge source team "${bridge.from.team}" does not exist in federation`,
        severity: 'error',
      });
    } else {
      // If source team has exports declared, signal must be in exports
      const sourceTeam = teams.get(bridge.from.team)!;
      if (sourceTeam.exports.length > 0) {
        const exportedSignals = new Set(sourceTeam.exports.map(e => e.signal));
        if (!exportedSignals.has(bridge.from.signal)) {
          warnings.push({
            path: 'bridges',
            message: `Bridge source signal "${bridge.from.signal}" is not in team "${bridge.from.team}" exports`,
            severity: 'warning',
          });
        }
      }
    }

    // Destination team must exist
    if (!teamKeys.has(bridge.to.team)) {
      errors.push({
        path: 'bridges',
        message: `Bridge destination team "${bridge.to.team}" does not exist in federation`,
        severity: 'error',
      });
    } else {
      // If dest team has imports declared, channel must be in imports
      const destTeam = teams.get(bridge.to.team)!;
      if (destTeam.imports.length > 0) {
        const importedChannel = destTeam.imports.find(i => i.channel === bridge.to.channel);
        if (!importedChannel) {
          warnings.push({
            path: 'bridges',
            message: `Bridge destination channel "${bridge.to.channel}" is not in team "${bridge.to.team}" imports`,
            severity: 'warning',
          });
        } else if (!importedChannel.signals.includes(bridge.to.signal)) {
          warnings.push({
            path: 'bridges',
            message: `Bridge destination signal "${bridge.to.signal}" is not declared in import channel "${bridge.to.channel}" of team "${bridge.to.team}"`,
            severity: 'warning',
          });
        }
      }
    }

    // Bridge from/to must be different teams
    if (bridge.from.team === bridge.to.team) {
      errors.push({
        path: 'bridges',
        message: `Bridge cannot route from team "${bridge.from.team}" to itself`,
        severity: 'error',
      });
    }
  }

  return { errors, warnings };
}
