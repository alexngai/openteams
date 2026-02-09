import { Command } from "commander";
import { TemplateService } from "../services/template-service";
import { CommunicationService } from "../services/communication-service";
import { TemplateLoader } from "../template/loader";
import type Database from "better-sqlite3";

export function createTemplateCommands(db: Database.Database): Command {
  const templateService = new TemplateService(db);
  const commService = new CommunicationService(db);
  const template = new Command("template").description(
    "Load and manage team templates"
  );

  template
    .command("load <dir>")
    .description("Load a team template from a directory and create a team")
    .option("-n, --name <name>", "Override the team name from the manifest")
    .action((dir: string, opts) => {
      try {
        const result = templateService.bootstrap(dir, opts.name);
        console.log(`Team "${result.team.name}" created from template.`);
        console.log(`  Roles: ${result.roles.join(", ")}`);
        if (result.channels.length > 0) {
          console.log(`  Channels: ${result.channels.join(", ")}`);
        }
        if (result.spawnRules.length > 0) {
          console.log("  Spawn rules:");
          for (const rule of result.spawnRules) {
            console.log(
              `    ${rule.from} -> [${rule.canSpawn.join(", ")}]`
            );
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  template
    .command("validate <dir>")
    .description("Validate a team template directory without creating a team")
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
    .command("info <team>")
    .description("Show template information for a team")
    .action((teamName: string) => {
      const info = templateService.getTemplateInfo(teamName);
      if (!info) {
        console.error(`Error: Team "${teamName}" not found.`);
        process.exitCode = 1;
        return;
      }
      if (!info.templateName) {
        console.log(`Team "${teamName}" was not created from a template.`);
        return;
      }
      console.log(`Template: ${info.templateName}`);
      if (info.templatePath) {
        console.log(`Source: ${info.templatePath}`);
      }

      // Show communication topology
      const channels = commService.listChannels(teamName);
      if (channels.length > 0) {
        console.log("\nChannels:");
        for (const ch of channels) {
          const desc = ch.description ? ` - ${ch.description}` : "";
          console.log(`  ${ch.name}${desc}`);
          console.log(`    Signals: ${ch.signals.join(", ")}`);
        }
      }

      const subs = commService.listSubscriptions(teamName);
      if (subs.length > 0) {
        console.log("\nSubscriptions:");
        // Group by role
        const grouped: Record<string, string[]> = {};
        for (const sub of subs) {
          if (!grouped[sub.role]) grouped[sub.role] = [];
          const label = sub.signal
            ? `${sub.channel}:${sub.signal}`
            : `${sub.channel}:*`;
          grouped[sub.role].push(label);
        }
        for (const [role, channels] of Object.entries(grouped)) {
          console.log(`  ${role}: ${channels.join(", ")}`);
        }
      }

      const routes = commService.listPeerRoutes(teamName);
      if (routes.length > 0) {
        console.log("\nPeer Routes:");
        for (const route of routes) {
          const signals =
            route.signals.length > 0
              ? ` [${route.signals.join(", ")}]`
              : "";
          console.log(
            `  ${route.from_role} -> ${route.to_role} via ${route.via}${signals}`
          );
        }
      }

      const spawnRules = templateService.listSpawnRules(teamName);
      if (spawnRules.length > 0) {
        console.log("\nSpawn Rules:");
        for (const rule of spawnRules) {
          console.log(
            `  ${rule.from} -> [${rule.canSpawn.join(", ")}]`
          );
        }
      }
    });

  template
    .command("emit <team>")
    .description("Emit a signal on a channel")
    .requiredOption("-c, --channel <channel>", "Channel name")
    .requiredOption("-s, --signal <signal>", "Signal name")
    .requiredOption("--sender <sender>", "Sender agent/role name")
    .option("-p, --payload <json>", "JSON payload")
    .action((teamName: string, opts) => {
      try {
        const { event, permitted, enforcement } = commService.emit({
          teamName,
          channel: opts.channel,
          signal: opts.signal,
          sender: opts.sender,
          payload: opts.payload ? JSON.parse(opts.payload) : undefined,
        });
        let msg = `Signal ${event.signal} emitted on ${event.channel} by ${event.sender} (event #${event.id}).`;
        if (!permitted && enforcement === "audit") {
          msg += ` [AUDIT: "${opts.sender}" is not permitted to emit "${opts.signal}"]`;
        }
        console.log(msg);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  template
    .command("events <team>")
    .description("List signal events for a team")
    .option("-c, --channel <channel>", "Filter by channel")
    .option("-s, --signal <signal>", "Filter by signal")
    .option("--sender <sender>", "Filter by sender")
    .option("--role <role>", "Show events visible to a specific role")
    .action((teamName: string, opts) => {
      let events;
      if (opts.role) {
        events = commService.getEventsForRole(teamName, opts.role);
      } else {
        events = commService.listEvents(teamName, {
          channel: opts.channel,
          signal: opts.signal,
          sender: opts.sender,
        });
      }

      if (events.length === 0) {
        console.log("No signal events found.");
        return;
      }

      for (const e of events) {
        const payload =
          e.payload && e.payload !== "{}" ? ` ${e.payload}` : "";
        console.log(
          `  #${e.id} [${e.channel}] ${e.signal} from ${e.sender}${payload}`
        );
      }
    });

  return template;
}
