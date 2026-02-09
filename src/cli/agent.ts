import { Command } from "commander";
import { AgentService } from "../services/agent-service";
import type Database from "better-sqlite3";
import type { AgentSpawner } from "../types";

export function createAgentCommands(
  db: Database.Database,
  spawner: AgentSpawner
): Command {
  const agentService = new AgentService(db, spawner);
  const agent = new Command("agent").description("Manage agents");

  agent
    .command("spawn <team>")
    .description("Spawn a new agent in a team")
    .requiredOption("-n, --name <name>", "Agent name")
    .requiredOption("-p, --prompt <prompt>", "Prompt/instructions for the agent")
    .option("-t, --type <type>", "Agent type (bash, general-purpose, explore, plan)", "general-purpose")
    .option("-m, --model <model>", "Model to use (sonnet, opus, haiku)")
    .option("--cwd <dir>", "Working directory for the agent")
    .action(async (team: string, opts) => {
      try {
        const member = await agentService.spawn({
          name: opts.name,
          teamName: team,
          prompt: opts.prompt,
          agentType: opts.type,
          model: opts.model,
          cwd: opts.cwd,
        });
        console.log(
          `Agent "${member.agent_name}" spawned in team "${team}" (id: ${member.agent_id}).`
        );
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  agent
    .command("list <team>")
    .description("List agents in a team")
    .option("--json", "Output as JSON")
    .action((team: string, opts) => {
      const members = agentService.listMembers(team);

      if (opts.json) {
        console.log(JSON.stringify(members));
        return;
      }

      if (members.length === 0) {
        console.log("No agents in this team.");
        return;
      }
      for (const m of members) {
        console.log(
          `  ${m.agent_name} [${m.status}] type=${m.agent_type}${m.model ? ` model=${m.model}` : ""}`
        );
      }
    });

  agent
    .command("info <team> <name>")
    .description("Show agent details")
    .option("--json", "Output as JSON")
    .action((team: string, name: string, opts) => {
      const member = agentService.getMember(team, name);
      if (!member) {
        console.error(`Error: Agent "${name}" not found in team "${team}".`);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(member));
        return;
      }

      console.log(`Agent: ${member.agent_name}`);
      console.log(`Team: ${member.team_name}`);
      console.log(`Status: ${member.status}`);
      console.log(`Type: ${member.agent_type}`);
      if (member.model) console.log(`Model: ${member.model}`);
      if (member.agent_id) console.log(`Agent ID: ${member.agent_id}`);
      if (member.spawn_prompt) console.log(`Prompt: ${member.spawn_prompt}`);
      console.log(`Created: ${member.created_at}`);
    });

  agent
    .command("shutdown <team> <name>")
    .description("Shut down an agent")
    .action(async (team: string, name: string) => {
      try {
        await agentService.shutdown(team, name);
        console.log(`Agent "${name}" shut down.`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return agent;
}
