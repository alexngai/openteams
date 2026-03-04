import { Command } from "commander";
import { TemplateInstallService } from "../template/install-service";
import { TemplateLoader } from "../template/loader";
import { listBuiltinTemplates } from "../template/builtins";
import { listAllTemplates, writeConfig, loadConfig } from "../template/resolver";
import type { OpenTeamsConfig } from "../template/types";
import { askYesNo, selectFromList } from "./prompt-utils";

export function createTemplateCommands(): Command {
  const template = new Command("template").description(
    "Validate, install, and manage team templates"
  );

  template
    .command("validate <dir>")
    .description("Validate a team template directory")
    .action((dir: string) => {
      try {
        const resolved = TemplateLoader.load(dir);
        console.log(`Template "${resolved.manifest.name}" is valid.`);
        console.log(`  Version: ${resolved.manifest.version}`);
        console.log(`  Roles: ${resolved.manifest.roles.join(", ")}`);
        console.log(`  Root: ${resolved.manifest.topology.root.role}`);
        if (resolved.manifest.topology.companions) {
          const companions = resolved.manifest.topology.companions.map(
            (c) => c.role
          );
          console.log(`  Companions: ${companions.join(", ")}`);
        }
        if (resolved.prompts.size > 0) {
          console.log(
            `  Prompts loaded: ${Array.from(resolved.prompts.keys()).join(", ")}`
          );
        }
        if (resolved.manifest.communication?.channels) {
          console.log(
            `  Channels: ${Object.keys(resolved.manifest.communication.channels).join(", ")}`
          );
        }
      } catch (err: any) {
        console.error(`Invalid template: ${err.message}`);
        process.exitCode = 1;
      }
    });

  template
    .command("list")
    .description("List all available templates (built-in, installed, global)")
    .option("--source <source>", "Filter by source: built-in, installed, global")
    .action((opts) => {
      const templates = listAllTemplates();

      if (templates.length === 0) {
        console.log("No templates found.");
        return;
      }

      let filtered = templates;
      if (opts.source) {
        const sourceMap: Record<string, string> = {
          "built-in": "built-in",
          installed: "installed",
          global: "installed (global)",
        };
        const filterSource = sourceMap[opts.source];
        if (filterSource) {
          filtered = templates.filter((t) => t.source === filterSource);
        }
      }

      if (filtered.length === 0) {
        console.log("No templates found matching the filter.");
        return;
      }

      console.log("Available templates:\n");
      for (const t of filtered) {
        const sourceLabel = `[${t.source}]`;
        const shadowLabel = t.shadows ? ` (shadowed by ${t.shadows})` : "";
        console.log(`  ${t.name}  ${sourceLabel}${shadowLabel}`);
        if (t.description) {
          const desc =
            t.description.length > 72
              ? t.description.substring(0, 69) + "..."
              : t.description;
          console.log(`    ${desc}`);
        }
        console.log();
      }

      console.log(
        `Use "openteams template validate <name>" or "openteams generate all <name>" with any template name above.`
      );
    });

  template
    .command("init")
    .description(
      "Initialize .openteams/config.json with default template configuration"
    )
    .option("--include <names...>", "Only include these built-in templates")
    .option("--exclude <names...>", "Exclude these built-in templates")
    .option("-d, --dir <path>", "Target directory", process.cwd())
    .action((opts) => {
      try {
        const builtins = listBuiltinTemplates();
        const builtinNames = builtins.map((b) => b.name);

        if (opts.include && opts.exclude) {
          console.error("Cannot use both --include and --exclude.");
          process.exitCode = 1;
          return;
        }

        // Validate names
        const namesToCheck = opts.include ?? opts.exclude ?? [];
        const invalid = namesToCheck.filter(
          (n: string) => !builtinNames.includes(n)
        );
        if (invalid.length > 0) {
          console.error(
            `Unknown built-in template(s): ${invalid.join(", ")}`
          );
          console.error(`Available: ${builtinNames.join(", ")}`);
          process.exitCode = 1;
          return;
        }

        const config: OpenTeamsConfig = {};
        if (opts.include) {
          config.defaults = { include: opts.include };
        } else if (opts.exclude) {
          config.defaults = { exclude: opts.exclude };
        }

        const configPath = writeConfig(config, opts.dir);
        console.log(`Created ${configPath}`);

        if (config.defaults?.include) {
          console.log(
            `  Active built-ins: ${config.defaults.include.join(", ")}`
          );
        } else if (config.defaults?.exclude) {
          console.log(
            `  Excluded built-ins: ${config.defaults.exclude.join(", ")}`
          );
        } else {
          console.log(`  All built-in templates are active (default).`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  template
    .command("install <repo-url> [template-name]")
    .description("Install a team template from a git repository")
    .option("-o, --output <path>", "Install to a specific directory")
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async (repoUrl: string, templateName: string | undefined, opts) => {
      try {
        const installService = new TemplateInstallService();

        const result = await installService.install(
          {
            repoUrl,
            templateName,
            outputDir: opts.output,
            skipConfirmation: opts.yes,
          },
          {
            selectTemplate: async (templates) => {
              const options = templates.map(
                (t) => `${t.name} (${t.manifestName})`
              );
              const chosen = await selectFromList(
                "Multiple templates found. Select one:",
                options
              );
              // Extract the name from "name (manifestName)"
              return chosen.split(" (")[0];
            },
            confirmGlobalInstall: async (installPath) => {
              return askYesNo(
                `No .openteams/ directory found. Install globally to ${installPath}?`
              );
            },
            onProgress: (message) => {
              console.log(message);
            },
          }
        );

        console.log(`Template "${result.templateName}" installed.`);
        console.log(`  Location: ${result.installedPath}`);
        console.log(`  Source: ${result.sourceRepo}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return template;
}
