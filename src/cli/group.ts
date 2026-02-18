import { Command } from "commander";
import type Database from "better-sqlite3";
import { TeamGroupService } from "../services/team-group-service";
import { GroupBootstrapService } from "../services/group-bootstrap-service";
import { CommunicationService } from "../services/communication-service";

export function createGroupCommands(db: Database.Database): Command {
  const groupService = new TeamGroupService(db);
  const bootstrapService = new GroupBootstrapService(db);
  const commService = new CommunicationService(db);

  const group = new Command("group").description(
    "Manage team groups (multi-team coordination)"
  );

  group
    .command("create <name>")
    .description("Create a new team group")
    .option("-d, --description <description>", "Group description")
    .action((name: string, opts: any) => {
      try {
        const result = groupService.create({
          name,
          description: opts.description,
        });
        console.log(`Group "${result.name}" created.`);
        if (result.description) console.log(`  Description: ${result.description}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  group
    .command("list")
    .description("List all active team groups")
    .option("--json", "Output as JSON")
    .action((opts: any) => {
      const groups = groupService.list();
      if (opts.json) {
        console.log(JSON.stringify(groups, null, 2));
        return;
      }
      if (groups.length === 0) {
        console.log("No active team groups.");
        return;
      }
      for (const g of groups) {
        const desc = g.description ? ` - ${g.description}` : "";
        const teams = groupService.listTeams(g.name);
        console.log(`  ${g.name}${desc} (${teams.length} team(s))`);
      }
    });

  group
    .command("info <name>")
    .description("Show group details with teams and bridges")
    .option("--json", "Output as JSON")
    .action((name: string, opts: any) => {
      const g = groupService.get(name);
      if (!g) {
        console.error(`Error: Group "${name}" not found.`);
        process.exitCode = 1;
        return;
      }

      const teams = groupService.listTeams(name);
      const bridges = groupService.listBridges(name);

      if (opts.json) {
        console.log(
          JSON.stringify({ group: g, teams, bridges }, null, 2)
        );
        return;
      }

      console.log(`Group: ${g.name}`);
      if (g.description) console.log(`Description: ${g.description}`);
      console.log(`Created: ${g.created_at}`);

      if (teams.length > 0) {
        console.log(`\nTeams (${teams.length}):`);
        for (const t of teams) {
          const desc = t.description ? ` - ${t.description}` : "";
          console.log(`  ${t.name}${desc}`);
        }
      }

      if (bridges.length > 0) {
        console.log(`\nBridges (${bridges.length}):`);
        for (const b of bridges) {
          const signals =
            b.signals.length > 0 ? ` [${b.signals.join(", ")}]` : "";
          console.log(
            `  ${b.source_team}/${b.source_channel} → ${b.target_team}/${b.target_channel}${signals} (${b.mode})`
          );
        }
      }
    });

  group
    .command("add-team <group-name> <team-name>")
    .description("Add an existing team to a group")
    .action((groupName: string, teamName: string) => {
      try {
        groupService.addTeam(groupName, teamName);
        console.log(`Team "${teamName}" added to group "${groupName}".`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  group
    .command("remove-team <group-name> <team-name>")
    .description("Remove a team from a group")
    .action((groupName: string, teamName: string) => {
      try {
        groupService.removeTeam(groupName, teamName);
        console.log(
          `Team "${teamName}" removed from group "${groupName}".`
        );
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  group
    .command("add-bridge <group-name>")
    .description("Add a cross-team signal bridge")
    .requiredOption(
      "--from <team/channel>",
      "Source: team-name/channel-name"
    )
    .requiredOption(
      "--to <team/channel>",
      "Target: team-name/channel-name"
    )
    .option(
      "--signals <signals>",
      "Comma-separated signal names to bridge"
    )
    .option("--mode <mode>", "Bridge mode: forward or bidirectional", "forward")
    .action((groupName: string, opts: any) => {
      try {
        const [sourceTeam, sourceChannel] = opts.from.split("/");
        const [targetTeam, targetChannel] = opts.to.split("/");

        if (!sourceTeam || !sourceChannel) {
          throw new Error(
            "--from must be in format: team-name/channel-name"
          );
        }
        if (!targetTeam || !targetChannel) {
          throw new Error(
            "--to must be in format: team-name/channel-name"
          );
        }

        const signals = opts.signals
          ? opts.signals.split(",").map((s: string) => s.trim())
          : undefined;

        const bridge = groupService.addBridge({
          groupName,
          sourceTeam,
          targetTeam,
          sourceChannel,
          targetChannel,
          signals,
          mode: opts.mode,
        });

        console.log(
          `Bridge created: ${sourceTeam}/${sourceChannel} → ${targetTeam}/${targetChannel} (${bridge.mode})`
        );
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  group
    .command("remove-bridge <bridge-id>")
    .description("Remove a cross-team signal bridge")
    .action((bridgeId: string) => {
      try {
        groupService.removeBridge(parseInt(bridgeId, 10));
        console.log(`Bridge ${bridgeId} removed.`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  group
    .command("load <dir>")
    .description("Bootstrap a group from a group.yaml template directory")
    .option("-n, --name <name>", "Override the group name")
    .action((dir: string, opts: any) => {
      try {
        const result = bootstrapService.bootstrap(dir, opts.name);
        console.log(`Group "${result.group.name}" bootstrapped.`);
        console.log(`  Teams: ${result.teams.length}`);
        console.log(`  Bridges: ${result.bridges.length}`);
        if (result.sharedAgents.length > 0) {
          console.log(`  Shared agents: ${result.sharedAgents.length}`);
        }
        for (const t of result.teams) {
          console.log(`  → ${t.team.name}: ${t.members.length} members, ${t.channels.length} channels`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  group
    .command("delete <name>")
    .description(
      "Delete a team group (all teams must be removed first)"
    )
    .action((name: string) => {
      try {
        groupService.delete(name);
        console.log(`Group "${name}" deleted.`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return group;
}
