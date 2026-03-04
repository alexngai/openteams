import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export interface BuiltinTemplateInfo {
  /** Directory name (the name used to load it) */
  name: string;
  /** The manifest name from team.yaml */
  manifestName: string;
  /** Short description from team.yaml */
  description: string;
  /** Absolute path to the template directory */
  path: string;
}

/**
 * Resolve the absolute path to the examples/ directory.
 * Walks up from __dirname to find the package root containing examples/.
 * Works from both src/template/ (dev/test) and dist/cjs/template/ (published).
 */
function getExamplesDir(): string {
  let dir = __dirname;
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, "examples");
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isDirectory()
    ) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  // Fallback: assume 3 levels up (dist/cjs/template -> root)
  return path.resolve(__dirname, "..", "..", "..", "examples");
}

/**
 * Check whether a string looks like a template name (vs a filesystem path).
 *
 * A template name contains no path separators, does not start with
 * `.` or `~`, and is not an absolute path.
 */
export function isTemplateName(input: string): boolean {
  if (input.includes("/") || input.includes("\\")) return false;
  if (input.startsWith(".")) return false;
  if (input.startsWith("~")) return false;
  if (path.isAbsolute(input)) return false;
  return true;
}

/**
 * Get the absolute path to a built-in template by name.
 * Returns null if no built-in template with that name exists.
 */
export function getBuiltinTemplateDir(name: string): string | null {
  const candidatePath = path.join(getExamplesDir(), name);

  if (
    fs.existsSync(candidatePath) &&
    fs.statSync(candidatePath).isDirectory() &&
    fs.existsSync(path.join(candidatePath, "team.yaml"))
  ) {
    return candidatePath;
  }

  return null;
}

/**
 * List all available built-in templates with their metadata.
 */
export function listBuiltinTemplates(): BuiltinTemplateInfo[] {
  const examplesDir = getExamplesDir();

  if (!fs.existsSync(examplesDir)) {
    return [];
  }

  const entries = fs.readdirSync(examplesDir, { withFileTypes: true });
  const results: BuiltinTemplateInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const teamYamlPath = path.join(examplesDir, entry.name, "team.yaml");
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
        path: path.join(examplesDir, entry.name),
      });
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
