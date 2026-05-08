import * as fs from "node:fs";
import { Command } from "commander";

import { TemplateLoader } from "../template/loader";
import {
  bundleLoadout,
  bundleTeam,
  verifyHash,
  verifyTeamHash,
} from "../sync/bundle";
import {
  LOADOUT_RESOURCE_TYPE,
  TEAM_RESOURCE_TYPE,
  type LoadoutResource,
  type TeamResource,
} from "../sync/types";

interface CommonBundleOpts {
  bundleVersion: string;
  output?: string;
  description?: string;
  tag?: string[];
  owner?: string;
  name?: string;
}

function appendTag(val: string, prev: string[] | undefined): string[] {
  return [...(prev ?? []), val];
}

function writeJson(value: unknown, output?: string): void {
  const json = JSON.stringify(value, null, 2);
  if (output) {
    fs.writeFileSync(output, json + "\n", "utf-8");
    console.error(`Wrote ${output}`);
  } else {
    console.log(json);
  }
}

export function createBundleCommands(): Command {
  const bundle = new Command("bundle").description(
    "Bundle templates and loadouts as MAP resources, and verify bundles"
  );

  bundle
    .command("team <dir>")
    .description("Bundle a team template as an x-openteams/team resource")
    .option(
      "--bundle-version <semver>",
      "Author-controlled version label (excluded from hash)",
      "0.0.0"
    )
    .option("-o, --output <file>", "Write bundle JSON to file (default: stdout)")
    .option("--name <name>", "Override the bundle's display name")
    .option("--description <text>", "Descriptive metadata (excluded from hash)")
    .option("--tag <tag>", "Tag (repeatable, excluded from hash)", appendTag)
    .option("--owner <id>", "Owner id (excluded from hash)")
    .action((dir: string, opts: CommonBundleOpts) => {
      try {
        const template = TemplateLoader.load(dir);
        const resource = bundleTeam(template, {
          version: opts.bundleVersion,
          name: opts.name,
          description: opts.description,
          tags: opts.tag,
          ownerId: opts.owner,
        });
        writeJson(resource, opts.output);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to bundle team: ${msg}`);
        process.exitCode = 1;
      }
    });

  bundle
    .command("loadout <dir> <name>")
    .description("Bundle a loadout from a template as an x-openteams/loadout resource")
    .option(
      "--bundle-version <semver>",
      "Author-controlled version label (excluded from hash)",
      "0.0.0"
    )
    .option("-o, --output <file>", "Write bundle JSON to file (default: stdout)")
    .option("--description <text>", "Descriptive metadata (excluded from hash)")
    .option("--tag <tag>", "Tag (repeatable, excluded from hash)", appendTag)
    .option("--owner <id>", "Owner id (excluded from hash)")
    .action((dir: string, name: string, opts: CommonBundleOpts) => {
      try {
        const template = TemplateLoader.load(dir);
        const resolved = template.loadouts.get(name);
        if (!resolved) {
          const available = Array.from(template.loadouts.keys());
          console.error(`Loadout not found: ${name}`);
          console.error(
            `Available: ${available.length > 0 ? available.join(", ") : "(none)"}`
          );
          process.exitCode = 1;
          return;
        }
        const resource = bundleLoadout(resolved, {
          version: opts.bundleVersion,
          name,
          description: opts.description,
          tags: opts.tag,
          ownerId: opts.owner,
        });
        writeJson(resource, opts.output);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to bundle loadout: ${msg}`);
        process.exitCode = 1;
      }
    });

  bundle
    .command("verify <file>")
    .description("Recompute the hash of a bundle JSON file and report the result")
    .action((file: string) => {
      try {
        const json =
          file === "-" ? fs.readFileSync(0, "utf-8") : fs.readFileSync(file, "utf-8");

        let resource: unknown;
        try {
          resource = JSON.parse(json);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Invalid JSON: ${msg}`);
          process.exitCode = 1;
          return;
        }

        if (
          !resource ||
          typeof resource !== "object" ||
          !("type" in resource) ||
          typeof (resource as { type: unknown }).type !== "string"
        ) {
          console.error("Not a recognized bundle: missing string 'type' field.");
          process.exitCode = 1;
          return;
        }

        const r = resource as { type: string; id?: string };
        if (r.type === LOADOUT_RESOURCE_TYPE) {
          const ok = verifyHash(resource as LoadoutResource);
          report(ok, r.type, r.id);
          if (!ok) process.exitCode = 1;
        } else if (r.type === TEAM_RESOURCE_TYPE) {
          const ok = verifyTeamHash(resource as TeamResource);
          report(ok, r.type, r.id);
          if (!ok) process.exitCode = 1;
        } else {
          console.error(`Unrecognized resource type: ${r.type}`);
          process.exitCode = 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to verify: ${msg}`);
        process.exitCode = 1;
      }
    });

  return bundle;
}

function report(ok: boolean, type: string, id: string | undefined): void {
  const idStr = id ?? "(no id)";
  if (ok) {
    console.log(`OK        ${type}  ${idStr}`);
  } else {
    console.error(`MISMATCH  ${type}  ${idStr}`);
  }
}
