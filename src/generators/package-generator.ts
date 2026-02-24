import fs from "fs";
import path from "path";
import type { ResolvedTemplate } from "../template/types";
import { generateSkillMd } from "./skill-generator";
import { generateCatalog } from "./skill-generator";
import { generateAllRoleSkillMds } from "./agent-prompt-generator";

export interface PackageGeneratorOptions {
  /** Team name override (defaults to manifest name) */
  teamName?: string;
  /** Output directory for the package */
  outputDir: string;
}

export interface PackageResult {
  /** Path to the generated top-level SKILL.md (catalog) */
  catalogPath: string;
  /** Paths to generated per-role SKILL.md files */
  rolePaths: { role: string; path: string }[];
  /** Path to the copied team.yaml (if source exists) */
  manifestPath: string | null;
}

/**
 * Generates a complete skill package directory from a resolved template.
 *
 * Package structure:
 *   <outputDir>/
 *   ├── SKILL.md                 # Team catalog (progressive disclosure)
 *   ├── team.yaml                # Copy of source manifest
 *   ├── roles/
 *   │   ├── <role>/
 *   │   │   └── SKILL.md         # Standalone role context
 *   │   └── ...
 *   └── prompts/                 # Copy of source prompts (if any)
 *       └── <role>.md
 */
export function generatePackage(
  template: ResolvedTemplate,
  options: PackageGeneratorOptions
): PackageResult {
  const teamName = options.teamName ?? template.manifest.name;
  const outDir = path.resolve(options.outputDir);

  // Create output directory
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Generate top-level SKILL.md (catalog)
  const catalogContent = generateCatalog(template, { teamName });
  const catalogPath = path.join(outDir, "SKILL.md");
  fs.writeFileSync(catalogPath, catalogContent, "utf-8");

  // 2. Generate per-role SKILL.md files
  const roleSkills = generateAllRoleSkillMds(template, { teamName });
  const rolePaths: { role: string; path: string }[] = [];

  for (const roleSkill of roleSkills) {
    const roleDir = path.join(outDir, "roles", roleSkill.role);
    fs.mkdirSync(roleDir, { recursive: true });
    const rolePath = path.join(roleDir, "SKILL.md");
    fs.writeFileSync(rolePath, roleSkill.content, "utf-8");
    rolePaths.push({ role: roleSkill.role, path: rolePath });
  }

  // 3. Copy team.yaml if source exists
  let manifestPath: string | null = null;
  if (template.sourcePath) {
    const sourceManifest = path.join(template.sourcePath, "team.yaml");
    if (fs.existsSync(sourceManifest)) {
      manifestPath = path.join(outDir, "team.yaml");
      fs.copyFileSync(sourceManifest, manifestPath);
    }
  }

  // 4. Copy prompts if source exists (supports both files and directories)
  if (template.sourcePath) {
    const sourcePrompts = path.join(template.sourcePath, "prompts");
    if (fs.existsSync(sourcePrompts)) {
      const promptsDir = path.join(outDir, "prompts");
      fs.mkdirSync(promptsDir, { recursive: true });
      const entries = fs.readdirSync(sourcePrompts, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(sourcePrompts, entry.name);
        const destPath = path.join(promptsDir, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          const subFiles = fs.readdirSync(srcPath);
          for (const subFile of subFiles) {
            fs.copyFileSync(
              path.join(srcPath, subFile),
              path.join(destPath, subFile)
            );
          }
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
  }

  return { catalogPath, rolePaths, manifestPath };
}
