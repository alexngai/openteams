import type Database from "better-sqlite3";
import type {
  TeamGroup,
  CreateTeamGroupOptions,
  TeamBridge,
  TeamBridgeRow,
  CreateTeamBridgeOptions,
  Team,
} from "../types";

function rowToBridge(row: TeamBridgeRow): TeamBridge {
  return {
    ...row,
    signals: JSON.parse(row.signals || "[]"),
  };
}

export class TeamGroupService {
  constructor(private db: Database.Database) {}

  // --- Group CRUD ---

  create(options: CreateTeamGroupOptions): TeamGroup {
    const existing = this.db
      .prepare(
        "SELECT name FROM team_groups WHERE name = ? AND status = 'active'"
      )
      .get(options.name) as { name: string } | undefined;

    if (existing) {
      throw new Error(`Team group "${options.name}" already exists`);
    }

    this.db
      .prepare(
        "INSERT INTO team_groups (name, description) VALUES (?, ?)"
      )
      .run(options.name, options.description ?? null);

    return this.get(options.name)!;
  }

  get(name: string): TeamGroup | null {
    const row = this.db
      .prepare(
        "SELECT * FROM team_groups WHERE name = ? AND status = 'active'"
      )
      .get(name) as TeamGroup | undefined;
    return row ?? null;
  }

  list(): TeamGroup[] {
    return this.db
      .prepare(
        "SELECT * FROM team_groups WHERE status = 'active' ORDER BY created_at DESC"
      )
      .all() as TeamGroup[];
  }

  delete(name: string): void {
    const group = this.get(name);
    if (!group) {
      throw new Error(`Team group "${name}" not found`);
    }

    const teams = this.listTeams(name);
    if (teams.length > 0) {
      throw new Error(
        `Team group "${name}" still has ${teams.length} team(s). Remove them first.`
      );
    }

    this.db
      .prepare("UPDATE team_groups SET status = 'deleted' WHERE name = ?")
      .run(name);
  }

  // --- Group ↔ Team membership ---

  addTeam(groupName: string, teamName: string): void {
    const group = this.get(groupName);
    if (!group) {
      throw new Error(`Team group "${groupName}" not found`);
    }

    const team = this.db
      .prepare("SELECT name FROM teams WHERE name = ? AND status = 'active'")
      .get(teamName) as { name: string } | undefined;
    if (!team) {
      throw new Error(`Team "${teamName}" not found`);
    }

    // Check if team is already in another group
    const current = this.db
      .prepare(
        "SELECT group_name FROM teams WHERE name = ? AND group_name IS NOT NULL"
      )
      .get(teamName) as { group_name: string } | undefined;
    if (current && current.group_name !== groupName) {
      throw new Error(
        `Team "${teamName}" is already in group "${current.group_name}"`
      );
    }

    this.db
      .prepare("UPDATE teams SET group_name = ? WHERE name = ?")
      .run(groupName, teamName);
  }

  removeTeam(groupName: string, teamName: string): void {
    const group = this.get(groupName);
    if (!group) {
      throw new Error(`Team group "${groupName}" not found`);
    }

    const team = this.db
      .prepare(
        "SELECT name, group_name FROM teams WHERE name = ? AND status = 'active'"
      )
      .get(teamName) as { name: string; group_name: string | null } | undefined;
    if (!team || team.group_name !== groupName) {
      throw new Error(
        `Team "${teamName}" is not in group "${groupName}"`
      );
    }

    // Remove any bridges involving this team
    this.db
      .prepare(
        "DELETE FROM team_bridges WHERE group_name = ? AND (source_team = ? OR target_team = ?)"
      )
      .run(groupName, teamName, teamName);

    this.db
      .prepare("UPDATE teams SET group_name = NULL WHERE name = ?")
      .run(teamName);
  }

  listTeams(groupName: string): Team[] {
    return this.db
      .prepare(
        "SELECT * FROM teams WHERE group_name = ? AND status = 'active' ORDER BY created_at"
      )
      .all(groupName) as Team[];
  }

  // --- Bridges ---

  addBridge(options: CreateTeamBridgeOptions): TeamBridge {
    const group = this.get(options.groupName);
    if (!group) {
      throw new Error(`Team group "${options.groupName}" not found`);
    }

    // Validate both teams are in the group
    const sourceTeam = this.db
      .prepare(
        "SELECT name, group_name FROM teams WHERE name = ? AND status = 'active'"
      )
      .get(options.sourceTeam) as
      | { name: string; group_name: string | null }
      | undefined;
    if (!sourceTeam || sourceTeam.group_name !== options.groupName) {
      throw new Error(
        `Team "${options.sourceTeam}" is not in group "${options.groupName}"`
      );
    }

    const targetTeam = this.db
      .prepare(
        "SELECT name, group_name FROM teams WHERE name = ? AND status = 'active'"
      )
      .get(options.targetTeam) as
      | { name: string; group_name: string | null }
      | undefined;
    if (!targetTeam || targetTeam.group_name !== options.groupName) {
      throw new Error(
        `Team "${options.targetTeam}" is not in group "${options.groupName}"`
      );
    }

    if (options.sourceTeam === options.targetTeam) {
      throw new Error("Cannot bridge a team to itself");
    }

    const result = this.db
      .prepare(
        `INSERT INTO team_bridges (group_name, source_team, target_team, source_channel, target_channel, signals, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        options.groupName,
        options.sourceTeam,
        options.targetTeam,
        options.sourceChannel,
        options.targetChannel,
        JSON.stringify(options.signals ?? []),
        options.mode ?? "forward"
      );

    return this.getBridge(Number(result.lastInsertRowid))!;
  }

  getBridge(id: number): TeamBridge | null {
    const row = this.db
      .prepare("SELECT * FROM team_bridges WHERE id = ?")
      .get(id) as TeamBridgeRow | undefined;
    return row ? rowToBridge(row) : null;
  }

  removeBridge(id: number): void {
    const bridge = this.getBridge(id);
    if (!bridge) {
      throw new Error(`Bridge ${id} not found`);
    }
    this.db.prepare("DELETE FROM team_bridges WHERE id = ?").run(id);
  }

  listBridges(groupName: string): TeamBridge[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM team_bridges WHERE group_name = ? ORDER BY id"
      )
      .all(groupName) as TeamBridgeRow[];
    return rows.map(rowToBridge);
  }

  /**
   * Get bridges that should forward signals FROM a given team+channel.
   * Used by CommunicationService to forward signals across team boundaries.
   */
  getBridgesForSource(
    teamName: string,
    channel: string
  ): TeamBridge[] {
    // Get the team's group
    const team = this.db
      .prepare(
        "SELECT group_name FROM teams WHERE name = ? AND status = 'active'"
      )
      .get(teamName) as { group_name: string | null } | undefined;

    if (!team?.group_name) return [];

    const rows = this.db
      .prepare(
        `SELECT * FROM team_bridges
         WHERE group_name = ? AND source_team = ? AND source_channel = ?`
      )
      .all(team.group_name, teamName, channel) as TeamBridgeRow[];

    // Also get bidirectional bridges where this team is the target
    const bidiRows = this.db
      .prepare(
        `SELECT * FROM team_bridges
         WHERE group_name = ? AND target_team = ? AND target_channel = ? AND mode = 'bidirectional'`
      )
      .all(team.group_name, teamName, channel) as TeamBridgeRow[];

    return [...rows.map(rowToBridge), ...bidiRows.map(rowToBridge)];
  }
}
