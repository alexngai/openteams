import * as yaml from 'js-yaml';
import type { TeamManifest, RoleDefinition } from '@openteams/template/types';

export interface BundledTemplate {
  manifest: TeamManifest;
  roles: Map<string, RoleDefinition>;
}

// Dynamically import all team.yaml and role files from examples/
const teamYamls = import.meta.glob('../../../examples/*/team.yaml', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const roleYamls = import.meta.glob('../../../examples/*/roles/*.yaml', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function buildTemplates(): Record<string, BundledTemplate> {
  const templates: Record<string, BundledTemplate> = {};

  for (const [path, content] of Object.entries(teamYamls)) {
    // path is like ../../../examples/gsd/team.yaml
    const match = path.match(/examples\/([^/]+)\/team\.yaml$/);
    if (!match) continue;
    const dirName = match[1];

    const manifest = yaml.load(content) as TeamManifest;
    const roles = new Map<string, RoleDefinition>();

    // Find all role files belonging to this example
    const rolePrefix = `../../../examples/${dirName}/roles/`;
    for (const [rolePath, roleContent] of Object.entries(roleYamls)) {
      if (rolePath.startsWith(rolePrefix)) {
        const role = yaml.load(roleContent) as RoleDefinition;
        if (role?.name) {
          roles.set(role.name, role);
        }
      }
    }

    templates[dirName] = { manifest, roles };
  }

  return templates;
}

export const BUNDLED_TEMPLATES: Record<string, BundledTemplate> = buildTemplates();
