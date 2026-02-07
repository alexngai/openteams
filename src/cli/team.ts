import { Command } from "commander";
import { TeamService } from "../services/team-service";
import type Database from "better-sqlite3";

export function createTeamCommands(db: Database.Database): Command {
  const teamService = new TeamService(db);
  const team = new Command("team").description("Manage teams");

  team
    .command("create <name>")
    .description("Create a new team")
    .option("-d, --description <description>", "Team description")
    .option("-t, --agent-type <type>", "Agent type for team lead")
    .action((name: string, opts) => {
      try {
        const result = teamService.create({
          name,
          description: opts.description,
          agentType: opts.agentType,
        });
        console.log(`Team "${result.name}" created.`);
        if (result.description) console.log(`  Description: ${result.description}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  team
    .command("list")
    .description("List all active teams")
    .action(() => {
      const teams = teamService.list();
      if (teams.length === 0) {
        console.log("No active teams.");
        return;
      }
      for (const t of teams) {
        const desc = t.description ? ` - ${t.description}` : "";
        console.log(`  ${t.name}${desc}`);
      }
    });

  team
    .command("info <name>")
    .description("Show team details")
    .action((name: string) => {
      const t = teamService.get(name);
      if (!t) {
        console.error(`Error: Team "${name}" not found.`);
        process.exitCode = 1;
        return;
      }
      console.log(`Team: ${t.name}`);
      if (t.description) console.log(`Description: ${t.description}`);
      if (t.agent_type) console.log(`Agent Type: ${t.agent_type}`);
      console.log(`Created: ${t.created_at}`);

      const members = teamService.listMembers(name);
      if (members.length > 0) {
        console.log(`\nMembers (${members.length}):`);
        for (const m of members) {
          console.log(`  ${m.agent_name} [${m.status}] (${m.agent_type})`);
        }
      }
    });

  team
    .command("delete <name>")
    .description("Delete a team (all members must be shut down first)")
    .action((name: string) => {
      try {
        teamService.delete(name);
        console.log(`Team "${name}" deleted.`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return team;
}
