import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import yaml from "js-yaml";
import { TemplateLoader } from "../template/loader";

// --- Types ---

export interface InstallOptions {
  repoUrl: string;
  templateName?: string;
  outputDir?: string;
  skipConfirmation?: boolean;
}

export interface InstallResult {
  templateName: string;
  installedPath: string;
  sourceRepo: string;
}

export interface DiscoveredTemplate {
  name: string;
  relativePath: string;
  manifestName: string;
}

export interface InstallMetadata {
  sourceRepo: string;
  templateName: string;
  installedAt: string;
  version: number;
}

export interface InstallCallbacks {
  selectTemplate(templates: DiscoveredTemplate[]): Promise<string>;
  confirmGlobalInstall(path: string): Promise<boolean>;
  onProgress(message: string): void;
}

// --- Service ---

export class TemplateInstallService {
  /**
   * Normalize a repo URL. Expands GitHub shorthand (owner/repo) to a full URL.
   */
  normalizeRepoUrl(repoUrl: string): string {
    // Already a full URL or SSH path
    if (
      repoUrl.startsWith("http://") ||
      repoUrl.startsWith("https://") ||
      repoUrl.startsWith("git@") ||
      repoUrl.startsWith("ssh://") ||
      repoUrl.startsWith("/") ||
      repoUrl.startsWith(".")
    ) {
      return repoUrl;
    }

    // GitHub shorthand: owner/repo (exactly one slash, no protocol)
    const parts = repoUrl.split("/");
    if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
      return `https://github.com/${repoUrl}.git`;
    }

    return repoUrl;
  }

  /**
   * Shallow-clone a git repo into a temp directory.
   */
  cloneRepo(repoUrl: string): string {
    const normalizedUrl = this.normalizeRepoUrl(repoUrl);
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openteams-install-")
    );

    try {
      execSync(`git clone --depth 1 "${normalizedUrl}" "${tmpDir}"`, {
        stdio: "pipe",
        timeout: 60_000,
      });
    } catch (err: any) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (err.code === "ENOENT") {
        throw new Error("git is not installed or not in PATH");
      }
      const stderr = err.stderr?.toString().trim();
      throw new Error(
        `Failed to clone ${normalizedUrl}: ${stderr || err.message}`
      );
    }

    return tmpDir;
  }

  /**
   * Scan a directory tree for template directories (those containing team.yaml).
   */
  discoverTemplates(repoDir: string): DiscoveredTemplate[] {
    // Future: prefer openteams.registry.yaml if present
    const registryPath = path.join(repoDir, "openteams.registry.yaml");
    if (fs.existsSync(registryPath)) {
      // TODO: Parse registry file for curated template listing
    }

    const templates: DiscoveredTemplate[] = [];
    this.scanForTemplates(repoDir, repoDir, templates);
    return templates;
  }

  private scanForTemplates(
    baseDir: string,
    currentDir: string,
    results: DiscoveredTemplate[]
  ): void {
    const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".openteams"]);

    const teamYamlPath = path.join(currentDir, "team.yaml");
    if (fs.existsSync(teamYamlPath)) {
      const content = fs.readFileSync(teamYamlPath, "utf-8");
      const manifest = yaml.load(content) as { name?: string };
      const dirName = path.basename(currentDir);
      const relativePath = path.relative(baseDir, currentDir);

      results.push({
        name: relativePath === "" ? dirName : path.basename(currentDir),
        relativePath: relativePath || ".",
        manifestName: manifest.name ?? dirName,
      });
      // Don't recurse into template directories
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        this.scanForTemplates(
          baseDir,
          path.join(currentDir, entry.name),
          results
        );
      }
    }
  }

  /**
   * Resolve where a template should be installed.
   * Walks up from cwd looking for .openteams/, falls back to global.
   */
  resolveInstallPath(
    templateName: string,
    explicitOutput?: string
  ): { path: string; isGlobal: boolean } {
    if (explicitOutput) {
      return { path: path.resolve(explicitOutput), isGlobal: false };
    }

    // Walk up from cwd looking for .openteams/
    let dir = process.cwd();
    while (true) {
      const candidate = path.join(dir, ".openteams");
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return {
          path: path.join(candidate, "templates", templateName),
          isGlobal: false,
        };
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // Fall back to global
    return {
      path: path.join(os.homedir(), ".openteams", "templates", templateName),
      isGlobal: true,
    };
  }

  /**
   * Recursively copy a template directory, skipping .git.
   */
  copyTemplate(sourceDir: string, destDir: string): void {
    fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".git") continue;

      const srcPath = path.join(sourceDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        this.copyTemplate(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Write install provenance metadata alongside the template.
   */
  writeMetadata(destDir: string, metadata: InstallMetadata): void {
    const metaPath = path.join(destDir, ".openteams-install.json");
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2) + "\n");
  }

  /**
   * Full install orchestration: clone → discover → select → copy → validate.
   */
  async install(
    options: InstallOptions,
    callbacks: InstallCallbacks
  ): Promise<InstallResult> {
    callbacks.onProgress(`Cloning ${options.repoUrl}...`);
    const repoDir = this.cloneRepo(options.repoUrl);

    try {
      // Discover templates
      const templates = this.discoverTemplates(repoDir);
      if (templates.length === 0) {
        throw new Error("No team templates found in repository");
      }

      // Select template
      let selected: DiscoveredTemplate;
      if (options.templateName) {
        const match = templates.find(
          (t) =>
            t.name === options.templateName ||
            t.manifestName === options.templateName
        );
        if (!match) {
          const available = templates.map((t) => t.name).join(", ");
          throw new Error(
            `Template "${options.templateName}" not found. Available: ${available}`
          );
        }
        selected = match;
      } else if (templates.length === 1) {
        selected = templates[0];
      } else {
        const chosenName = await callbacks.selectTemplate(templates);
        const match = templates.find((t) => t.name === chosenName);
        if (!match) {
          throw new Error(`Template "${chosenName}" not found`);
        }
        selected = match;
      }

      callbacks.onProgress(`Installing template "${selected.manifestName}"...`);

      // Resolve install location
      const { path: installPath, isGlobal } = this.resolveInstallPath(
        selected.manifestName,
        options.outputDir
      );

      // Confirm global install if needed
      if (isGlobal && !options.skipConfirmation) {
        const confirmed = await callbacks.confirmGlobalInstall(installPath);
        if (!confirmed) {
          throw new Error("Installation cancelled by user");
        }
      }

      // Remove existing installation if present
      if (fs.existsSync(installPath)) {
        fs.rmSync(installPath, { recursive: true, force: true });
      }

      // Copy template files
      const sourceDir =
        selected.relativePath === "."
          ? repoDir
          : path.join(repoDir, selected.relativePath);
      this.copyTemplate(sourceDir, installPath);

      // Validate the installed template
      callbacks.onProgress("Validating installed template...");
      const resolved = TemplateLoader.load(installPath);

      // Write install metadata
      this.writeMetadata(installPath, {
        sourceRepo: options.repoUrl,
        templateName: resolved.manifest.name,
        installedAt: new Date().toISOString(),
        version: resolved.manifest.version,
      });

      return {
        templateName: resolved.manifest.name,
        installedPath: installPath,
        sourceRepo: options.repoUrl,
      };
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  }
}
