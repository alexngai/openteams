import type Database from "better-sqlite3";
import type { Team } from "../types";
import type { ResolvedTemplate, TeamManifest } from "../template/types";
import { TemplateLoader } from "../template/loader";
import { TeamService } from "./team-service";
import { CommunicationService } from "./communication-service";

export interface BootstrapResult {
  team: Team;
  roles: string[];
  channels: string[];
  spawnRules: Array<{ from: string; canSpawn: string[] }>;
}

export class TemplateService {
  private teamService: TeamService;
  private commService: CommunicationService;

  constructor(private db: Database.Database) {
    this.teamService = new TeamService(db);
    this.commService = new CommunicationService(db);
  }

  /**
   * Load a template from a directory and create a team from it.
   * This is the primary entry point: load template → create team → wire communication → store spawn rules.
   */
  bootstrap(templateDir: string, teamNameOverride?: string): BootstrapResult {
    const template = TemplateLoader.load(templateDir);
    return this.bootstrapFromTemplate(template, teamNameOverride);
  }

  /**
   * Bootstrap from an already-resolved template (for programmatic/test use).
   */
  bootstrapFromTemplate(
    template: ResolvedTemplate,
    teamNameOverride?: string
  ): BootstrapResult {
    const teamName = teamNameOverride ?? template.manifest.name;

    // Create the team
    const team = this.teamService.create({
      name: teamName,
      description: template.manifest.description,
      templateName: template.manifest.name,
      templatePath: template.sourcePath || undefined,
    });

    // Apply communication topology
    if (template.manifest.communication) {
      this.commService.applyConfig(teamName, template.manifest.communication);
    }

    // Store spawn rules
    const spawnRules: Array<{ from: string; canSpawn: string[] }> = [];
    if (template.manifest.topology.spawn_rules) {
      const insertRule = this.db.prepare(
        "INSERT OR IGNORE INTO spawn_rules (team_name, from_role, to_role) VALUES (?, ?, ?)"
      );
      for (const [from, targets] of Object.entries(
        template.manifest.topology.spawn_rules
      )) {
        for (const to of targets) {
          insertRule.run(teamName, from, to);
        }
        spawnRules.push({ from, canSpawn: targets });
      }
    }

    const channels = template.manifest.communication?.channels
      ? Object.keys(template.manifest.communication.channels)
      : [];

    return {
      team,
      roles: template.manifest.roles,
      channels,
      spawnRules,
    };
  }

  /**
   * Bootstrap from a raw manifest object (no filesystem needed).
   */
  bootstrapFromManifest(
    manifest: TeamManifest,
    teamNameOverride?: string
  ): BootstrapResult {
    const template = TemplateLoader.loadFromManifest(manifest);
    return this.bootstrapFromTemplate(template, teamNameOverride);
  }

  /**
   * Get the template info for a team.
   */
  getTemplateInfo(
    teamName: string
  ): { templateName: string | null; templatePath: string | null } | null {
    const team = this.teamService.get(teamName);
    if (!team) return null;
    return {
      templateName: team.template_name,
      templatePath: team.template_path,
    };
  }

  /**
   * Check if a role can spawn another role within a team.
   */
  canSpawn(teamName: string, fromRole: string, toRole: string): boolean {
    // If no spawn rules exist for this team, allow all (permissive)
    const anyRules = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM spawn_rules WHERE team_name = ?"
      )
      .get(teamName) as { count: number };

    if (anyRules.count === 0) return true;

    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM spawn_rules WHERE team_name = ? AND from_role = ? AND to_role = ?"
      )
      .get(teamName, fromRole, toRole) as { count: number };

    return row.count > 0;
  }

  /**
   * Get spawn rules for a role.
   */
  getSpawnRules(teamName: string, fromRole: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT to_role FROM spawn_rules WHERE team_name = ? AND from_role = ?"
      )
      .all(teamName, fromRole) as Array<{ to_role: string }>;
    return rows.map((r) => r.to_role);
  }

  /**
   * List all spawn rules for a team.
   */
  listSpawnRules(
    teamName: string
  ): Array<{ from: string; canSpawn: string[] }> {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT from_role FROM spawn_rules WHERE team_name = ? ORDER BY from_role"
      )
      .all(teamName) as Array<{ from_role: string }>;

    return rows.map((r) => ({
      from: r.from_role,
      canSpawn: this.getSpawnRules(teamName, r.from_role),
    }));
  }
}
