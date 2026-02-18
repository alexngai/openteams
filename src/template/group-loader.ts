import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type {
  GroupManifest,
  GroupTeamEntry,
  ResolvedTemplate,
} from "./types";
import { TemplateLoader } from "./loader";

export interface ResolvedGroup {
  manifest: GroupManifest;
  /** Resolved templates for each team, keyed by team name */
  teams: Map<string, ResolvedTemplate>;
  sourcePath: string;
}

export class GroupLoader {
  /**
   * Load a group manifest from a directory.
   * Expects: group.yaml in the directory root.
   * Team templates are resolved relative to the group directory.
   */
  static load(groupDir: string): ResolvedGroup {
    const absDir = path.resolve(groupDir);

    if (!fs.existsSync(absDir)) {
      throw new Error(`Group directory not found: ${absDir}`);
    }

    const manifestPath = path.join(absDir, "group.yaml");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`group.yaml not found in ${absDir}`);
    }

    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    const manifest = yaml.load(manifestContent) as GroupManifest;

    GroupLoader.validateManifest(manifest);

    const teams = new Map<string, ResolvedTemplate>();

    for (const entry of manifest.teams) {
      const template = GroupLoader.resolveTeamEntry(absDir, entry);
      teams.set(entry.name, template);
    }

    return {
      manifest,
      teams,
      sourcePath: absDir,
    };
  }

  /**
   * Load from an inline manifest object (no filesystem).
   */
  static loadFromManifest(manifest: GroupManifest): ResolvedGroup {
    GroupLoader.validateManifest(manifest);

    const teams = new Map<string, ResolvedTemplate>();

    for (const entry of manifest.teams) {
      if (entry.inline) {
        const template = TemplateLoader.loadFromManifest(entry.inline);
        teams.set(entry.name, template);
      } else {
        throw new Error(
          `Team "${entry.name}" requires either 'template' path or 'inline' manifest when loading from manifest object`
        );
      }
    }

    return {
      manifest,
      teams,
      sourcePath: "",
    };
  }

  private static validateManifest(manifest: GroupManifest): void {
    if (!manifest.name) {
      throw new Error("Group manifest missing required field: name");
    }
    if (!manifest.version) {
      throw new Error("Group manifest missing required field: version");
    }
    if (!manifest.teams || !Array.isArray(manifest.teams) || manifest.teams.length === 0) {
      throw new Error("Group manifest must define at least one team");
    }

    // Check for duplicate team names
    const teamNames = new Set<string>();
    for (const entry of manifest.teams) {
      if (!entry.name) {
        throw new Error("Each team entry must have a name");
      }
      if (teamNames.has(entry.name)) {
        throw new Error(`Duplicate team name in group: "${entry.name}"`);
      }
      teamNames.add(entry.name);

      if (!entry.template && !entry.inline) {
        throw new Error(
          `Team "${entry.name}" must specify either 'template' path or 'inline' manifest`
        );
      }
    }

    // Validate shared_agents reference valid teams
    if (manifest.shared_agents) {
      for (const agent of manifest.shared_agents) {
        if (!agent.agent) {
          throw new Error("Each shared_agent must have an agent name");
        }
        if (!agent.memberships || agent.memberships.length === 0) {
          throw new Error(
            `Shared agent "${agent.agent}" must have at least one membership`
          );
        }
        for (const mem of agent.memberships) {
          if (!teamNames.has(mem.team)) {
            throw new Error(
              `Shared agent "${agent.agent}" references unknown team "${mem.team}"`
            );
          }
        }
      }
    }

    // Validate bridges reference valid teams
    if (manifest.bridges) {
      for (const bridge of manifest.bridges) {
        if (!bridge.from?.team || !bridge.from?.channel) {
          throw new Error("Each bridge must specify from.team and from.channel");
        }
        if (!bridge.to?.team || !bridge.to?.channel) {
          throw new Error("Each bridge must specify to.team and to.channel");
        }
        if (!teamNames.has(bridge.from.team)) {
          throw new Error(
            `Bridge references unknown source team "${bridge.from.team}"`
          );
        }
        if (!teamNames.has(bridge.to.team)) {
          throw new Error(
            `Bridge references unknown target team "${bridge.to.team}"`
          );
        }
        if (bridge.from.team === bridge.to.team) {
          throw new Error("Bridge cannot connect a team to itself");
        }
      }
    }
  }

  private static resolveTeamEntry(
    groupDir: string,
    entry: GroupTeamEntry
  ): ResolvedTemplate {
    if (entry.inline) {
      return TemplateLoader.loadFromManifest(entry.inline);
    }

    if (entry.template) {
      const templateDir = path.resolve(groupDir, entry.template);
      return TemplateLoader.load(templateDir);
    }

    throw new Error(
      `Team "${entry.name}" has neither 'template' nor 'inline'`
    );
  }
}
