import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type {
  FederationManifest,
  FederationBridge,
  FederationTeamEntry,
  ResolvedFederation,
  ResolvedTemplate,
  LoadOptions,
} from "./types";
import { TemplateLoader } from "./loader";

/**
 * Load and validate a federation manifest from a directory.
 *
 * Expects a federation.yaml file. Loads each referenced team template
 * and validates bridge wiring against exports/imports.
 */
export function loadFederation(
  federationDir: string,
  options?: LoadOptions
): ResolvedFederation {
  const absDir = path.resolve(federationDir);
  const manifestPath = path.join(absDir, "federation.yaml");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`federation.yaml not found in ${absDir}`);
  }

  const content = fs.readFileSync(manifestPath, "utf-8");
  const manifest = yaml.load(content) as FederationManifest;

  validateFederationManifest(manifest);

  // Load each team template
  const teams = new Map<string, ResolvedTemplate>();
  for (const [teamKey, entry] of Object.entries(manifest.teams)) {
    const templatePath = resolveTemplatePath(absDir, entry);
    const template = TemplateLoader.load(templatePath, options);
    teams.set(teamKey, template);
  }

  const bridges = manifest.bridges ?? [];

  // Validate bridges against team exports/imports
  validateBridges(bridges, teams);

  return { manifest, teams, bridges };
}

/**
 * Compose a federation programmatically from already-loaded templates.
 *
 * Useful for testing or dynamic federation construction.
 */
export function composeFederation(config: {
  name: string;
  version?: number;
  teams: Record<string, { template: ResolvedTemplate; placement?: FederationTeamEntry["placement"] }>;
  bridges?: FederationBridge[];
  enforcement?: FederationManifest["enforcement"];
}): ResolvedFederation {
  const teams = new Map<string, ResolvedTemplate>();
  const manifestTeams: Record<string, FederationTeamEntry> = {};

  for (const [key, entry] of Object.entries(config.teams)) {
    teams.set(key, entry.template);
    manifestTeams[key] = {
      template: entry.template.sourcePath || key,
      placement: entry.placement,
    };
  }

  const bridges = config.bridges ?? [];
  validateBridges(bridges, teams);

  const manifest: FederationManifest = {
    name: config.name,
    version: config.version ?? 1,
    teams: manifestTeams,
    bridges,
    enforcement: config.enforcement,
  };

  return { manifest, teams, bridges };
}

// ─── Validation ──────────────────────────────────────────────

function validateFederationManifest(manifest: FederationManifest): void {
  if (!manifest.name) {
    throw new Error("Federation manifest missing required field: name");
  }
  if (!manifest.version) {
    throw new Error("Federation manifest missing required field: version");
  }
  if (!manifest.teams || Object.keys(manifest.teams).length === 0) {
    throw new Error("Federation manifest must define at least one team");
  }

  // Check for duplicate team keys is implicit (object keys are unique)

  // Validate bridge references point to declared teams
  const teamKeys = new Set(Object.keys(manifest.teams));
  for (const bridge of manifest.bridges ?? []) {
    if (!teamKeys.has(bridge.from.team)) {
      throw new Error(
        `Bridge references unknown source team "${bridge.from.team}"`
      );
    }
    if (!teamKeys.has(bridge.to.team)) {
      throw new Error(
        `Bridge references unknown destination team "${bridge.to.team}"`
      );
    }
  }
}

/**
 * Validate bridges against loaded team templates.
 *
 * If a team declares exports, bridge source signals must be in exports.
 * If a team declares imports, bridge destination channels must be in imports.
 * Import channels must have at least one role subscribed.
 */
function validateBridges(
  bridges: FederationBridge[],
  teams: Map<string, ResolvedTemplate>
): void {
  for (const bridge of bridges) {
    const sourceTemplate = teams.get(bridge.from.team);
    const destTemplate = teams.get(bridge.to.team);

    if (!sourceTemplate) {
      throw new Error(
        `Bridge references unknown source team "${bridge.from.team}"`
      );
    }
    if (!destTemplate) {
      throw new Error(
        `Bridge references unknown destination team "${bridge.to.team}"`
      );
    }

    // Validate source signal exists in team's exports (if exports declared)
    const exports = sourceTemplate.manifest.communication?.exports;
    if (exports && exports.length > 0) {
      const exportedSignals = new Set(exports.map((e) => e.signal));
      if (!exportedSignals.has(bridge.from.signal)) {
        throw new Error(
          `Bridge source signal "${bridge.from.signal}" is not exported by team "${bridge.from.team}". ` +
          `Exported signals: ${[...exportedSignals].join(", ")}`
        );
      }
    }

    // Validate source signal exists in team's emissions
    const emissions = sourceTemplate.manifest.communication?.emissions;
    if (emissions) {
      const allEmittedSignals = new Set(
        Object.values(emissions).flat()
      );
      if (!allEmittedSignals.has(bridge.from.signal)) {
        throw new Error(
          `Bridge source signal "${bridge.from.signal}" is not emitted by any role in team "${bridge.from.team}"`
        );
      }
    }

    // Validate destination channel exists in team's imports (if imports declared)
    const imports = destTemplate.manifest.communication?.imports;
    if (imports && imports.length > 0) {
      const importDef = imports.find((i) => i.channel === bridge.to.channel);
      if (!importDef) {
        throw new Error(
          `Bridge destination channel "${bridge.to.channel}" is not imported by team "${bridge.to.team}". ` +
          `Imported channels: ${imports.map((i) => i.channel).join(", ")}`
        );
      }
      // Validate the signal is declared in the import
      if (!importDef.signals.includes(bridge.to.signal)) {
        throw new Error(
          `Bridge destination signal "${bridge.to.signal}" is not declared in import channel "${bridge.to.channel}" ` +
          `of team "${bridge.to.team}". Declared signals: ${importDef.signals.join(", ")}`
        );
      }
    }

    // Validate destination channel exists in the team's channels
    const channels = destTemplate.manifest.communication?.channels;
    if (channels && !channels[bridge.to.channel]) {
      throw new Error(
        `Bridge destination channel "${bridge.to.channel}" is not defined in team "${bridge.to.team}"`
      );
    }

    // Validate the destination signal exists in the channel definition
    if (channels?.[bridge.to.channel]) {
      const channelDef = channels[bridge.to.channel];
      if (!channelDef.signals.includes(bridge.to.signal)) {
        throw new Error(
          `Bridge destination signal "${bridge.to.signal}" is not defined in channel "${bridge.to.channel}" ` +
          `of team "${bridge.to.team}"`
        );
      }
    }

    // Warn-level: check that at least one role subscribes to the destination channel
    const subscriptions = destTemplate.manifest.communication?.subscriptions;
    if (subscriptions) {
      const hasSubscriber = Object.values(subscriptions).some((subs) =>
        subs.some((s) => s.channel === bridge.to.channel)
      );
      if (!hasSubscriber) {
        // This is a validation issue but not necessarily fatal —
        // the signal arrives but nobody listens. We throw because
        // this is almost certainly a configuration error.
        throw new Error(
          `Bridge destination channel "${bridge.to.channel}" in team "${bridge.to.team}" ` +
          `has no subscribed roles — bridged signals would be undelivered`
        );
      }
    }
  }
}

function resolveTemplatePath(
  federationDir: string,
  entry: FederationTeamEntry
): string {
  const templateRef = entry.template;

  // If it looks like a relative path, resolve against federation dir
  if (templateRef.startsWith("./") || templateRef.startsWith("../")) {
    return path.resolve(federationDir, templateRef);
  }

  // Otherwise, treat as a template name (TemplateLoader will resolve it)
  return templateRef;
}
