import type Database from "better-sqlite3";
import type { Team, CreateTeamOptions, Member, MemberStatus } from "../types";

export class TeamService {
  constructor(private db: Database.Database) {}

  create(options: CreateTeamOptions): Team {
    const existing = this.db
      .prepare("SELECT name FROM teams WHERE name = ? AND status = 'active'")
      .get(options.name) as { name: string } | undefined;

    if (existing) {
      throw new Error(`Team "${options.name}" already exists`);
    }

    this.db
      .prepare(
        "INSERT INTO teams (name, description, agent_type, template_name, template_path) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        options.name,
        options.description ?? null,
        options.agentType ?? null,
        options.templateName ?? null,
        options.templatePath ?? null
      );

    return this.get(options.name)!;
  }

  get(name: string): Team | null {
    const row = this.db
      .prepare("SELECT * FROM teams WHERE name = ? AND status = 'active'")
      .get(name) as Team | undefined;
    return row ?? null;
  }

  list(): Team[] {
    return this.db
      .prepare("SELECT * FROM teams WHERE status = 'active' ORDER BY created_at DESC")
      .all() as Team[];
  }

  delete(name: string): void {
    const team = this.get(name);
    if (!team) {
      throw new Error(`Team "${name}" not found`);
    }

    const activeMembers = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM members WHERE team_name = ? AND status != 'shutdown'"
      )
      .get(name) as { count: number };

    if (activeMembers.count > 0) {
      throw new Error(
        `Team "${name}" still has ${activeMembers.count} active member(s). Shut them down first.`
      );
    }

    this.db
      .prepare("UPDATE teams SET status = 'deleted' WHERE name = ?")
      .run(name);
  }

  addMember(
    teamName: string,
    agentName: string,
    options?: {
      agentId?: string;
      agentType?: string;
      role?: string;
      spawnPrompt?: string;
      model?: string;
    }
  ): Member {
    const team = this.get(teamName);
    if (!team) {
      throw new Error(`Team "${teamName}" not found`);
    }

    this.db
      .prepare(
        `INSERT INTO members (team_name, agent_name, agent_id, agent_type, role, spawn_prompt, model)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        teamName,
        agentName,
        options?.agentId ?? null,
        options?.agentType ?? "general-purpose",
        options?.role ?? null,
        options?.spawnPrompt ?? null,
        options?.model ?? null
      );

    return this.getMember(teamName, agentName)!;
  }

  getMember(teamName: string, agentName: string): Member | null {
    const row = this.db
      .prepare(
        "SELECT * FROM members WHERE team_name = ? AND agent_name = ?"
      )
      .get(teamName, agentName) as Member | undefined;
    return row ?? null;
  }

  listMembers(teamName: string): Member[] {
    return this.db
      .prepare("SELECT * FROM members WHERE team_name = ? ORDER BY created_at")
      .all(teamName) as Member[];
  }

  updateMemberStatus(
    teamName: string,
    agentName: string,
    status: MemberStatus
  ): void {
    this.db
      .prepare(
        "UPDATE members SET status = ? WHERE team_name = ? AND agent_name = ?"
      )
      .run(status, teamName, agentName);
  }

  updateMemberAgentId(
    teamName: string,
    agentName: string,
    agentId: string
  ): void {
    this.db
      .prepare(
        "UPDATE members SET agent_id = ? WHERE team_name = ? AND agent_name = ?"
      )
      .run(agentId, teamName, agentName);
  }
}
