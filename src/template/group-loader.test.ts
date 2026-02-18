import { describe, it, expect } from "vitest";
import type { GroupManifest, TeamManifest } from "./types";
import { GroupLoader } from "./group-loader";

function makeTeamManifest(name: string, roles: string[]): TeamManifest {
  return {
    name,
    version: 1,
    roles,
    topology: {
      root: { role: roles[0] },
      companions: roles.slice(1).map((r) => ({ role: r })),
    },
  };
}

describe("GroupLoader", () => {
  describe("loadFromManifest", () => {
    it("resolves a valid group manifest", () => {
      const manifest: GroupManifest = {
        name: "test-group",
        version: 1,
        teams: [
          {
            name: "team-a",
            inline: makeTeamManifest("a", ["orchestrator", "worker"]),
          },
          {
            name: "team-b",
            inline: makeTeamManifest("b", ["leader", "executor"]),
          },
        ],
      };

      const resolved = GroupLoader.loadFromManifest(manifest);

      expect(resolved.manifest.name).toBe("test-group");
      expect(resolved.teams.size).toBe(2);
      expect(resolved.teams.has("team-a")).toBe(true);
      expect(resolved.teams.has("team-b")).toBe(true);

      const teamA = resolved.teams.get("team-a")!;
      expect(teamA.manifest.roles).toEqual(["orchestrator", "worker"]);
    });

    it("throws on missing name", () => {
      expect(() =>
        GroupLoader.loadFromManifest({
          version: 1,
          teams: [{ name: "t", inline: makeTeamManifest("t", ["r"]) }],
        } as any)
      ).toThrow("missing required field: name");
    });

    it("throws on missing version", () => {
      expect(() =>
        GroupLoader.loadFromManifest({
          name: "g",
          teams: [{ name: "t", inline: makeTeamManifest("t", ["r"]) }],
        } as any)
      ).toThrow("missing required field: version");
    });

    it("throws on empty teams", () => {
      expect(() =>
        GroupLoader.loadFromManifest({
          name: "g",
          version: 1,
          teams: [],
        })
      ).toThrow("at least one team");
    });

    it("throws on duplicate team names", () => {
      expect(() =>
        GroupLoader.loadFromManifest({
          name: "g",
          version: 1,
          teams: [
            { name: "dup", inline: makeTeamManifest("dup", ["r"]) },
            { name: "dup", inline: makeTeamManifest("dup2", ["r"]) },
          ],
        })
      ).toThrow('Duplicate team name in group: "dup"');
    });

    it("throws when team has no template or inline", () => {
      expect(() =>
        GroupLoader.loadFromManifest({
          name: "g",
          version: 1,
          teams: [{ name: "t" } as any],
        })
      ).toThrow("must specify either 'template' path or 'inline' manifest");
    });

    it("throws when shared_agent references unknown team", () => {
      expect(() =>
        GroupLoader.loadFromManifest({
          name: "g",
          version: 1,
          teams: [{ name: "t1", inline: makeTeamManifest("t1", ["r"]) }],
          shared_agents: [
            {
              agent: "a1",
              memberships: [{ team: "unknown-team", role: "r" }],
            },
          ],
        })
      ).toThrow('references unknown team "unknown-team"');
    });

    it("throws when bridge references unknown team", () => {
      expect(() =>
        GroupLoader.loadFromManifest({
          name: "g",
          version: 1,
          teams: [{ name: "t1", inline: makeTeamManifest("t1", ["r"]) }],
          bridges: [
            {
              from: { team: "t1", channel: "ch" },
              to: { team: "unknown", channel: "ch" },
            },
          ],
        })
      ).toThrow('references unknown target team "unknown"');
    });

    it("throws when bridge connects a team to itself", () => {
      expect(() =>
        GroupLoader.loadFromManifest({
          name: "g",
          version: 1,
          teams: [{ name: "t1", inline: makeTeamManifest("t1", ["r"]) }],
          bridges: [
            {
              from: { team: "t1", channel: "ch" },
              to: { team: "t1", channel: "ch" },
            },
          ],
        })
      ).toThrow("cannot connect a team to itself");
    });

    it("validates shared_agents with valid teams", () => {
      const resolved = GroupLoader.loadFromManifest({
        name: "g",
        version: 1,
        teams: [
          { name: "t1", inline: makeTeamManifest("t1", ["r1", "r2"]) },
          { name: "t2", inline: makeTeamManifest("t2", ["r3", "r4"]) },
        ],
        shared_agents: [
          {
            agent: "multi-agent",
            memberships: [
              { team: "t1", role: "r1" },
              { team: "t2", role: "r3" },
            ],
          },
        ],
      });

      expect(resolved.manifest.shared_agents).toHaveLength(1);
    });

    it("validates bridges with valid teams", () => {
      const resolved = GroupLoader.loadFromManifest({
        name: "g",
        version: 1,
        teams: [
          {
            name: "t1",
            inline: {
              ...makeTeamManifest("t1", ["r1"]),
              communication: {
                channels: { out: { signals: ["SIG"] } },
              },
            },
          },
          {
            name: "t2",
            inline: {
              ...makeTeamManifest("t2", ["r2"]),
              communication: {
                channels: { in: { signals: ["SIG"] } },
              },
            },
          },
        ],
        bridges: [
          {
            from: { team: "t1", channel: "out" },
            to: { team: "t2", channel: "in" },
            mode: "bidirectional",
          },
        ],
      });

      expect(resolved.manifest.bridges).toHaveLength(1);
    });
  });
});
