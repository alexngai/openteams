import { Command } from "commander";
import { TemplateInstallService } from "../template/install-service";
import { TemplateLoader } from "../template/loader";
import { askYesNo, selectFromList } from "./prompt-utils";

export function createTemplateCommands(): Command {
  const template = new Command("template").description(
    "Validate and install team templates"
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
