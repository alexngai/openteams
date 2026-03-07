import fs from "fs";
import path from "path";
import { Command } from "commander";
import { TemplateLoader } from "../template/loader";
import { generateSkillMd, generateCatalog } from "../generators/skill-generator";
import {
  generateAgentPrompts,
  generateAgentPrompt,
  generateRoleSkillMd,
} from "../generators/agent-prompt-generator";
import { generatePackage } from "../generators/package-generator";

export function createGenerateCommands(): Command {
  const generate = new Command("generate").description(
    "Generate SKILL.md and agent prompts from a team template"
  );

  generate
    .command("skill <dir>")
    .description(
      "Generate a SKILL.md file from a team template directory"
    )
    .option("-n, --name <name>", "Override the team name")
    .option(
      "-o, --output <path>",
      "Output path (default: <dir>/SKILL.md)"
    )
    .option("--no-cli-examples", "Omit CLI usage examples")
    .option("--no-spawn-rules", "Omit spawn rules section")
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const content = generateSkillMd(template, {
          teamName,
          includeCliExamples: opts.cliExamples !== false,
          includeSpawnRules: opts.spawnRules !== false,
        });

        const outputPath = opts.output ?? path.join(dir, "SKILL.md");
        fs.writeFileSync(outputPath, content, "utf-8");
        console.log(`Generated SKILL.md at ${outputPath}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  generate
    .command("agents <dir>")
    .description(
      "Generate agent prompt files from a team template directory"
    )
    .option("-n, --name <name>", "Override the team name")
    .option(
      "-o, --output <path>",
      "Output directory for prompt files (default: <dir>/agents/)"
    )
    .option("--preamble <text>", "Additional context to prepend to every prompt")
    .option("--no-spawn-section", "Omit spawn permissions from agent prompts")
    .option("--no-cli-section", "Omit CLI quick reference from agent prompts")
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const prompts = generateAgentPrompts(template, {
          teamName,
          preamble: opts.preamble,
          includeSpawnSection: opts.spawnSection !== false,
          includeCliSection: opts.cliSection !== false,
        });

        const outputDir = opts.output ?? path.join(dir, "agents");
        fs.mkdirSync(outputDir, { recursive: true });

        for (const agentPrompt of prompts) {
          const filePath = path.join(outputDir, `${agentPrompt.role}.md`);
          fs.writeFileSync(filePath, agentPrompt.prompt, "utf-8");
          console.log(`  ${agentPrompt.role} -> ${filePath}`);
        }
        console.log(
          `Generated ${prompts.length} agent prompt(s) in ${outputDir}`
        );
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  generate
    .command("all <dir>")
    .description(
      "Generate SKILL.md and all agent prompts from a team template"
    )
    .option("-n, --name <name>", "Override the team name")
    .option(
      "-o, --output <path>",
      "Output base directory (default: <dir>)"
    )
    .option("--preamble <text>", "Additional context for agent prompts")
    .option("--no-spawn-rules", "Omit spawn rules from SKILL.md")
    .option("--no-spawn-section", "Omit spawn permissions from agent prompts")
    .option("--no-cli-section", "Omit CLI quick reference from agent prompts")
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const baseDir = opts.output ?? dir;

        // Generate SKILL.md
        const skillContent = generateSkillMd(template, {
          teamName,
          includeSpawnRules: opts.spawnRules !== false,
        });
        const skillPath = path.join(baseDir, "SKILL.md");
        fs.writeFileSync(skillPath, skillContent, "utf-8");
        console.log(`Generated ${skillPath}`);

        // Generate agent prompts
        const prompts = generateAgentPrompts(template, {
          teamName,
          preamble: opts.preamble,
          includeSpawnSection: opts.spawnSection !== false,
          includeCliSection: opts.cliSection !== false,
        });
        const agentsDir = path.join(baseDir, "agents");
        fs.mkdirSync(agentsDir, { recursive: true });

        for (const agentPrompt of prompts) {
          const filePath = path.join(agentsDir, `${agentPrompt.role}.md`);
          fs.writeFileSync(filePath, agentPrompt.prompt, "utf-8");
          console.log(`  ${agentPrompt.role} -> ${filePath}`);
        }
        console.log(
          `\nGenerated SKILL.md + ${prompts.length} agent prompt(s) for team "${teamName}"`
        );
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  generate
    .command("package <dir>")
    .description(
      "Generate a skill package directory from a team template"
    )
    .option("-n, --name <name>", "Override the team name")
    .option(
      "-o, --output <path>",
      "Output directory (default: <dir>/package/)"
    )
    .option("--no-spawn-section", "Omit spawn permissions from role SKILL.md files")
    .option("--no-cli-section", "Omit CLI quick reference from role SKILL.md files")
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const outputDir = opts.output ?? path.join(dir, "package");

        const result = generatePackage(template, {
          teamName,
          outputDir,
          includeSpawnSection: opts.spawnSection !== false,
          includeCliSection: opts.cliSection !== false,
        });

        console.log(`Generated skill package in ${outputDir}`);
        console.log(`  Catalog: ${result.catalogPath}`);
        for (const rp of result.rolePaths) {
          console.log(`  ${rp.role}: ${rp.path}`);
        }
        if (result.manifestPath) {
          console.log(`  Manifest: ${result.manifestPath}`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  generate
    .command("catalog <dir>")
    .description(
      "Generate a lightweight team catalog from a template"
    )
    .option("-n, --name <name>", "Override the team name")
    .option("-o, --output <path>", "Output path (default: stdout)")
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const content = generateCatalog(template, { teamName });

        if (opts.output) {
          fs.writeFileSync(opts.output, content, "utf-8");
          console.log(`Generated catalog at ${opts.output}`);
        } else {
          process.stdout.write(content);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  generate
    .command("role-package <dir>")
    .description(
      "Generate a standalone SKILL.md for a specific role"
    )
    .requiredOption("-r, --role <role>", "Role name")
    .option("-n, --name <name>", "Override the team name")
    .option("-o, --output <path>", "Output path (default: stdout)")
    .option("--no-spawn-section", "Omit spawn permissions section")
    .option("--no-cli-section", "Omit CLI quick reference section")
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const result = generateRoleSkillMd(template, opts.role, {
          teamName,
          includeSpawnSection: opts.spawnSection !== false,
          includeCliSection: opts.cliSection !== false,
        });

        if (opts.output) {
          const outDir = path.dirname(opts.output);
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(opts.output, result.content, "utf-8");
          console.log(`Generated role package at ${opts.output}`);
        } else {
          process.stdout.write(result.content);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return generate;
}
