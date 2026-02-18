import type Database from "better-sqlite3";
import type { TeamGroup } from "../types";
import type { GroupManifest } from "../template/types";
import type { ResolvedGroup } from "../template/group-loader";
import type { BootstrapResult } from "./template-service";
import { GroupLoader } from "../template/group-loader";
import { TeamGroupService } from "./team-group-service";
import { TeamService } from "./team-service";
import { TemplateService } from "./template-service";

export interface GroupBootstrapResult {
  group: TeamGroup;
  teams: BootstrapResult[];
  bridges: number[];
  sharedAgents: Array<{
    agent: string;
    memberships: Array<{ team: string; role: string }>;
  }>;
}

export class GroupBootstrapService {
  private groupService: TeamGroupService;
  private teamService: TeamService;
  private templateService: TemplateService;

  constructor(private db: Database.Database) {
    this.groupService = new TeamGroupService(db);
    this.teamService = new TeamService(db);
    this.templateService = new TemplateService(db);
  }

  /**
   * Bootstrap an entire group from a directory containing group.yaml.
   */
  bootstrap(groupDir: string, groupNameOverride?: string): GroupBootstrapResult {
    const resolved = GroupLoader.load(groupDir);
    return this.bootstrapFromResolved(resolved, groupNameOverride);
  }

  /**
   * Bootstrap from a raw GroupManifest (no filesystem needed).
   */
  bootstrapFromManifest(
    manifest: GroupManifest,
    groupNameOverride?: string
  ): GroupBootstrapResult {
    const resolved = GroupLoader.loadFromManifest(manifest);
    return this.bootstrapFromResolved(resolved, groupNameOverride);
  }

  /**
   * Bootstrap from a fully resolved group.
   */
  bootstrapFromResolved(
    resolved: ResolvedGroup,
    groupNameOverride?: string
  ): GroupBootstrapResult {
    const groupName = groupNameOverride ?? resolved.manifest.name;

    // 1. Create the group
    const group = this.groupService.create({
      name: groupName,
      description: resolved.manifest.description,
    });

    // 2. Bootstrap each team and add to group
    const teams: BootstrapResult[] = [];
    for (const [teamName, template] of resolved.teams) {
      const result = this.templateService.bootstrapFromTemplate(
        template,
        teamName
      );
      this.groupService.addTeam(groupName, teamName);
      teams.push(result);
    }

    // 3. Register shared agents across teams
    const sharedAgents: GroupBootstrapResult["sharedAgents"] = [];
    if (resolved.manifest.shared_agents) {
      for (const shared of resolved.manifest.shared_agents) {
        for (const mem of shared.memberships) {
          // Check if agent already exists in this team (from template bootstrap)
          const existing = this.teamService.getMember(mem.team, shared.agent);
          if (!existing) {
            this.teamService.addMember(mem.team, shared.agent, {
              role: mem.role,
              agentType: "general-purpose",
            });
          }
        }
        sharedAgents.push({
          agent: shared.agent,
          memberships: shared.memberships.map((m) => ({
            team: m.team,
            role: m.role,
          })),
        });
      }
    }

    // 4. Set up bridges
    const bridgeIds: number[] = [];
    if (resolved.manifest.bridges) {
      for (const bridgeDef of resolved.manifest.bridges) {
        const bridge = this.groupService.addBridge({
          groupName,
          sourceTeam: bridgeDef.from.team,
          targetTeam: bridgeDef.to.team,
          sourceChannel: bridgeDef.from.channel,
          targetChannel: bridgeDef.to.channel,
          signals: bridgeDef.from.signals,
          mode: bridgeDef.mode,
        });
        bridgeIds.push(bridge.id);
      }
    }

    return {
      group,
      teams,
      bridges: bridgeIds,
      sharedAgents,
    };
  }
}
