import { Command } from "commander";
import { TemplateLoader } from "../template/loader";
import {
  generateLoadoutArtifacts,
  getEffectiveLoadout,
  listInlineLoadoutRoles,
  listLoadoutConsumers,
  renderLoadoutYaml,
} from "../generators/loadout-generator";

export function createLoadoutCommands(): Command {
  const loadout = new Command("loadout").description(
    "Inspect and validate template loadouts"
  );

  loadout
    .command("validate <dir>")
    .description("Validate all loadouts in a template")
    .action((dir: string) => {
      try {
        const tpl = TemplateLoader.load(dir);
        if (tpl.loadouts.size === 0) {
          console.log(
            `Template "${tpl.manifest.name}" has no loadouts.`
          );
          return;
        }
        console.log(
          `Template "${tpl.manifest.name}" — ${tpl.loadouts.size} loadout(s):`
        );
        for (const [name, lo] of tpl.loadouts) {
          const parent = lo.extends ? ` extends ${lo.extends}` : "";
          const caps = lo.capabilities.length;
          const mcps = lo.mcpServers.length;
          const capLabel = `${caps} cap${caps === 1 ? "" : "s"}`;
          const mcpLabel = `${mcps} MCP`;
          console.log(`  ${name}${parent}  (${capLabel}, ${mcpLabel})`);
        }
      } catch (err: any) {
        console.error(`Invalid template: ${err.message}`);
        process.exitCode = 1;
      }
    });

  loadout
    .command("list <dir>")
    .description("List loadouts and which roles consume each")
    .action((dir: string) => {
      try {
        const tpl = TemplateLoader.load(dir);
        const consumers = listLoadoutConsumers(tpl);
        const inlineRoles = listInlineLoadoutRoles(tpl);

        if (consumers.size === 0 && inlineRoles.length === 0) {
          console.log("No loadouts defined.");
          return;
        }

        if (consumers.size > 0) {
          const nameWidth = Math.max(
            "Loadout".length,
            ...[...consumers.keys()].map((n) => n.length)
          );
          console.log(
            `${"Loadout".padEnd(nameWidth)}  Consumers`
          );
          console.log(
            `${"-".repeat(nameWidth)}  ${"-".repeat(9)}`
          );
          for (const [name, roles] of consumers) {
            const rolesLabel = roles.length === 0 ? "(unused)" : roles.join(", ");
            console.log(`${name.padEnd(nameWidth)}  ${rolesLabel}`);
          }
        }

        if (inlineRoles.length > 0) {
          if (consumers.size > 0) console.log();
          console.log(
            `Roles with inline loadouts: ${inlineRoles.join(", ")}`
          );
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  loadout
    .command("show <dir> <name>")
    .description("Render a resolved loadout (after extends chain)")
    .option("--json", "Output JSON artifacts instead of YAML")
    .action((dir: string, name: string, opts) => {
      try {
        const tpl = TemplateLoader.load(dir);
        const lo = tpl.loadouts.get(name);
        if (!lo) {
          console.error(`Loadout "${name}" not found.`);
          const available = [...tpl.loadouts.keys()];
          if (available.length > 0) {
            console.error(`Available: ${available.join(", ")}`);
          }
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(generateLoadoutArtifacts(lo), null, 2));
        } else {
          process.stdout.write(renderLoadoutYaml(lo));
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  loadout
    .command("preview <dir> <role>")
    .description("Render the effective loadout bound to a role")
    .option("--json", "Output JSON artifacts instead of YAML")
    .action((dir: string, roleName: string, opts) => {
      try {
        const tpl = TemplateLoader.load(dir);
        if (!tpl.roles.has(roleName)) {
          console.error(`Role "${roleName}" not found.`);
          console.error(
            `Available: ${[...tpl.roles.keys()].join(", ")}`
          );
          process.exitCode = 1;
          return;
        }
        const lo = getEffectiveLoadout(tpl, roleName);
        if (!lo) {
          console.log(`Role "${roleName}" has no loadout binding.`);
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(generateLoadoutArtifacts(lo), null, 2));
        } else {
          console.log(`# Effective loadout for role "${roleName}"\n`);
          process.stdout.write(renderLoadoutYaml(lo));
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return loadout;
}
