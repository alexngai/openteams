import * as yaml from 'js-yaml';
import { useCanvasStore } from '../stores/canvas-store';
import { useConfigStore } from '../stores/config-store';
import { canvasToManifest, rolesToDefinitions } from './serializer';

export interface CompiledFile {
  path: string;
  content: string;
}

const YAML_OPTIONS: yaml.DumpOptions = {
  lineWidth: -1,
  noRefs: true,
  quotingType: '"',
  forceQuotes: false,
  sortKeys: false,
};

export function compileToYaml(): CompiledFile[] {
  const config = useConfigStore.getState();
  const canvas = useCanvasStore.getState();

  // Collect models from canvas node data
  const roleModels = new Map<string, string>();
  for (const node of canvas.nodes) {
    if (node.data.kind === 'role' && node.data.model) {
      roleModels.set(node.data.roleName, node.data.model);
    }
  }

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

  const files: CompiledFile[] = [];

  // team.yaml
  files.push({
    path: 'team.yaml',
    content: yaml.dump(manifest, YAML_OPTIONS),
  });

  // roles/*.yaml
  const roleDefs = rolesToDefinitions(config.roles);
  for (const [name, def] of roleDefs) {
    files.push({
      path: `roles/${name}.yaml`,
      content: yaml.dump(def, YAML_OPTIONS),
    });
  }

  // prompts/*
  for (const [name, role] of config.roles) {
    if (role.promptContent) {
      files.push({
        path: `prompts/${name}/ROLE.md`,
        content: role.promptContent,
      });
    }
    if (role.additionalPrompts) {
      for (const p of role.additionalPrompts) {
        if (p.content) {
          files.push({
            path: `prompts/${name}/${p.name}`,
            content: p.content,
          });
        }
      }
    }
  }

  return files;
}
