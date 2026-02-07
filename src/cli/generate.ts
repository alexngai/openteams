import fs from "fs";
import path from "path";
import { Command } from "commander";
import { TemplateLoader } from "../template/loader";
import { generateSkillMd } from "../generators/skill-generator";
import {
  generateAgentPrompts,
  generateAgentPrompt,
} from "../generators/agent-prompt-generator";

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
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const content = generateSkillMd(template, {
          teamName,
          includeCliExamples: opts.cliExamples !== false,
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
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const prompts = generateAgentPrompts(template, {
          teamName,
          preamble: opts.preamble,
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
    .action((dir: string, opts) => {
      try {
        const template = TemplateLoader.load(dir);
        const teamName = opts.name ?? template.manifest.name;
        const baseDir = opts.output ?? dir;

        // Generate SKILL.md
        const skillContent = generateSkillMd(template, { teamName });
        const skillPath = path.join(baseDir, "SKILL.md");
        fs.writeFileSync(skillPath, skillContent, "utf-8");
        console.log(`Generated ${skillPath}`);

        // Generate agent prompts
        const prompts = generateAgentPrompts(template, {
          teamName,
          preamble: opts.preamble,
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

  return generate;
}
