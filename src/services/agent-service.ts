import type Database from "better-sqlite3";
import type { AgentSpawner, AgentInstance, SpawnAgentOptions, Member } from "../types";
import { TeamService } from "./team-service";

export class AgentService {
  private teamService: TeamService;

  constructor(
    private db: Database.Database,
    private spawner: AgentSpawner
  ) {
    this.teamService = new TeamService(db);
  }

  async spawn(options: SpawnAgentOptions): Promise<Member> {
    const team = this.teamService.get(options.teamName);
    if (!team) {
      throw new Error(`Team "${options.teamName}" not found`);
    }

    const existing = this.teamService.getMember(options.teamName, options.name);
    if (existing && existing.status !== "shutdown") {
      throw new Error(
        `Agent "${options.name}" already exists in team "${options.teamName}"`
      );
    }

    const instance = await this.spawner.spawn(options);

    if (existing) {
      this.teamService.updateMemberAgentId(
        options.teamName,
        options.name,
        instance.id
      );
      this.teamService.updateMemberStatus(
        options.teamName,
        options.name,
        "running"
      );
    } else {
      this.teamService.addMember(options.teamName, options.name, {
        agentId: instance.id,
        agentType: options.agentType,
        spawnPrompt: options.prompt,
        model: options.model,
      });
      this.teamService.updateMemberStatus(
        options.teamName,
        options.name,
        "running"
      );
    }

    return this.teamService.getMember(options.teamName, options.name)!;
  }

  async shutdown(teamName: string, agentName: string): Promise<void> {
    const member = this.teamService.getMember(teamName, agentName);
    if (!member) {
      throw new Error(
        `Agent "${agentName}" not found in team "${teamName}"`
      );
    }

    if (member.agent_id) {
      await this.spawner.shutdown(member.agent_id);
    }

    this.teamService.updateMemberStatus(teamName, agentName, "shutdown");
  }

  listMembers(teamName: string): Member[] {
    return this.teamService.listMembers(teamName);
  }

  getMember(teamName: string, agentName: string): Member | null {
    return this.teamService.getMember(teamName, agentName);
  }

  getRunningInstances(): AgentInstance[] {
    return this.spawner.list();
  }
}
