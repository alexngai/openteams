import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import { listBuiltinTemplates, getBuiltinTemplateDir } from "./builtins";
import type {
  TemplateInfo,
  TemplateSource,
  OpenTeamsConfig,
} from "./types";

const CONFIG_FILENAME = "config.json";

/**
 * Find the .openteams/ directory by walking up from startDir.
 * Returns null if not found.
 */
export function findOpenTeamsDir(startDir?: string): string | null {
  let dir = startDir ?? process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, ".openteams");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Find the .openteams/config.json path by walking up from startDir.
 * Returns null if not found.
 */
export function findConfigPath(startDir?: string): string | null {
  const openteamsDir = findOpenTeamsDir(startDir);
  if (!openteamsDir) return null;

  const configPath = path.join(openteamsDir, CONFIG_FILENAME);
  return fs.existsSync(configPath) ? configPath : null;
}

/**
 * Load .openteams/config.json by walking up from startDir.
 * Returns null if no config file exists (all defaults active).
 */
export function loadConfig(startDir?: string): OpenTeamsConfig | null {
  const configPath = findConfigPath(startDir);
  if (!configPath) return null;

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as OpenTeamsConfig;
  } catch {
    return null;
  }
}

/**
 * Check if a built-in template name is enabled given the config.
 * If no config or no defaults section, all built-ins are enabled.
 */
export function isBuiltinEnabled(
  name: string,
  config: OpenTeamsConfig | null
): boolean {
  if (!config?.defaults) return true;

  const { include, exclude } = config.defaults;

  if (include && include.length > 0) {
    return include.includes(name);
  }
  if (exclude && exclude.length > 0) {
    return !exclude.includes(name);
  }
  return true;
}

/**
 * List installed templates from a directory.
 * Each subdirectory containing team.yaml is a template.
 */
function listInstalledFromDir(
  templatesDir: string,
  source: TemplateSource
): TemplateInfo[] {
  if (!fs.existsSync(templatesDir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(templatesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: TemplateInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const teamYamlPath = path.join(templatesDir, entry.name, "team.yaml");
    if (!fs.existsSync(teamYamlPath)) continue;

    try {
      const content = fs.readFileSync(teamYamlPath, "utf-8");
      const manifest = yaml.load(content) as {
        name?: string;
        description?: string;
      };

      results.push({
        name: entry.name,
        manifestName: manifest.name ?? entry.name,
        description: manifest.description ?? "",
        path: path.join(templatesDir, entry.name),
        source,
      });
    } catch {
      continue;
    }
  }

  return results;
}

/**
 * List ALL available templates from all sources.
 * Computes shadow relationships. Sorted by name.
 */
export function listAllTemplates(startDir?: string): TemplateInfo[] {
  const config = loadConfig(startDir);
  const openteamsDir = findOpenTeamsDir(startDir);

  // 1. Local installed (highest priority)
  const localInstalled = openteamsDir
    ? listInstalledFromDir(path.join(openteamsDir, "templates"), "installed")
    : [];

  // 2. Global installed
  const globalDir = path.join(os.homedir(), ".openteams", "templates");
  const globalInstalled = listInstalledFromDir(globalDir, "installed (global)");

  // 3. Built-in (filtered by config)
  const builtins: TemplateInfo[] = listBuiltinTemplates()
    .filter((b) => isBuiltinEnabled(b.name, config))
    .map((b) => ({
      name: b.name,
      manifestName: b.manifestName,
      description: b.description,
      path: b.path,
      source: "built-in" as TemplateSource,
    }));

  const all = [...localInstalled, ...globalInstalled, ...builtins];

  // Compute shadows: for each name, the first occurrence (highest priority)
  // is the winner; lower-priority entries get shadows set.
  const winners = new Map<string, TemplateSource>();
  for (const t of all) {
    if (winners.has(t.name)) {
      t.shadows = winners.get(t.name);
    } else {
      winners.set(t.name, t.source);
    }
  }

  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a template name to an absolute directory path.
 * Resolution order: local installed > global installed > built-in (if enabled).
 * Returns null if not found.
 */
export function resolveTemplateName(
  name: string,
  startDir?: string
): string | null {
  const config = loadConfig(startDir);
  const openteamsDir = findOpenTeamsDir(startDir);

  // 1. Local installed
  if (openteamsDir) {
    const localPath = path.join(openteamsDir, "templates", name);
    if (
      fs.existsSync(localPath) &&
      fs.statSync(localPath).isDirectory() &&
      fs.existsSync(path.join(localPath, "team.yaml"))
    ) {
      return localPath;
    }
  }

  // 2. Global installed
  const globalPath = path.join(os.homedir(), ".openteams", "templates", name);
  if (
    fs.existsSync(globalPath) &&
    fs.statSync(globalPath).isDirectory() &&
    fs.existsSync(path.join(globalPath, "team.yaml"))
  ) {
    return globalPath;
  }

  // 3. Built-in (if enabled)
  if (isBuiltinEnabled(name, config)) {
    return getBuiltinTemplateDir(name);
  }

  return null;
}

/**
 * Write .openteams/config.json.
 * Creates .openteams/ directory if it doesn't exist.
 * Returns the path to the written config file.
 */
export function writeConfig(
  config: OpenTeamsConfig,
  targetDir: string
): string {
  const openteamsDir = path.join(targetDir, ".openteams");
  fs.mkdirSync(openteamsDir, { recursive: true });
  const configPath = path.join(openteamsDir, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}
