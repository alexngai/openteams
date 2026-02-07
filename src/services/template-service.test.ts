import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { TemplateService } from "./template-service";
import { CommunicationService } from "./communication-service";
import { TeamService } from "./team-service";
import type { TeamManifest } from "../template/types";

describe("TemplateService", () => {
  let db: Database.Database;
  let templateService: TemplateService;
  let commService: CommunicationService;
  let teamService: TeamService;

  const selfDrivingManifest: TeamManifest = {
    name: "self-driving",
    description: "Autonomous codebase development",
    version: 1,
    roles: ["planner", "grinder", "judge"],
    topology: {
      root: { role: "planner", config: { model: "sonnet" } },
      companions: [{ role: "judge", config: { model: "haiku" } }],
      spawn_rules: {
        planner: ["grinder", "planner"],
        judge: [],
        grinder: [],
      },
    },
    communication: {
      channels: {
        task_updates: {
          description: "Task events",
          signals: ["TASK_CREATED", "TASK_COMPLETED", "TASK_FAILED"],
        },
        work_coordination: {
          signals: ["WORK_ASSIGNED", "WORKER_DONE"],
        },
      },
      subscriptions: {
        planner: [
          { channel: "task_updates" },
          { channel: "work_coordination", signals: ["WORKER_DONE"] },
        ],
        judge: [{ channel: "task_updates", signals: ["TASK_FAILED"] }],
        grinder: [
          { channel: "work_coordination", signals: ["WORK_ASSIGNED"] },
        ],
      },
      emissions: {
        planner: ["TASK_CREATED", "WORK_ASSIGNED"],
        grinder: ["WORKER_DONE"],
      },
      routing: {
        peers: [
          {
            from: "judge",
            to: "planner",
            via: "direct",
            signals: ["FIXUP_CREATED"],
          },
        ],
      },
    },
  };

  beforeEach(() => {
    db = createInMemoryDatabase();
    templateService = new TemplateService(db);
    commService = new CommunicationService(db);
    teamService = new TeamService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("bootstrapFromManifest", () => {
    it("creates a team with template metadata", () => {
      const result = templateService.bootstrapFromManifest(
        selfDrivingManifest
      );

      expect(result.team.name).toBe("self-driving");
      expect(result.team.description).toBe(
        "Autonomous codebase development"
      );
      expect(result.team.template_name).toBe("self-driving");
      expect(result.roles).toEqual(["planner", "grinder", "judge"]);
    });

    it("allows overriding the team name", () => {
      const result = templateService.bootstrapFromManifest(
        selfDrivingManifest,
        "my-project"
      );

      expect(result.team.name).toBe("my-project");
      expect(result.team.template_name).toBe("self-driving");
    });

    it("sets up channels", () => {
      templateService.bootstrapFromManifest(selfDrivingManifest);

      const channels = commService.listChannels("self-driving");
      expect(channels).toHaveLength(2);
      expect(channels.map((c) => c.name).sort()).toEqual([
        "task_updates",
        "work_coordination",
      ]);
    });

    it("sets up subscriptions", () => {
      templateService.bootstrapFromManifest(selfDrivingManifest);

      const subs = commService.listSubscriptions("self-driving");
      expect(subs.length).toBeGreaterThan(0);

      const plannerSubs = commService.getSubscriptionsForRole(
        "self-driving",
        "planner"
      );
      expect(plannerSubs).toHaveLength(2);
    });

    it("sets up spawn rules", () => {
      const result = templateService.bootstrapFromManifest(
        selfDrivingManifest
      );

      expect(result.spawnRules).toHaveLength(3);

      const plannerRule = result.spawnRules.find(
        (r) => r.from === "planner"
      )!;
      expect(plannerRule.canSpawn).toEqual(["grinder", "planner"]);

      // Judge and grinder can't spawn
      expect(
        result.spawnRules.find((r) => r.from === "judge")!.canSpawn
      ).toEqual([]);
    });

    it("sets up peer routes", () => {
      templateService.bootstrapFromManifest(selfDrivingManifest);

      const routes = commService.listPeerRoutes("self-driving");
      expect(routes).toHaveLength(1);
      expect(routes[0].from_role).toBe("judge");
      expect(routes[0].to_role).toBe("planner");
    });
  });

  describe("canSpawn", () => {
    it("respects spawn rules", () => {
      templateService.bootstrapFromManifest(selfDrivingManifest);

      expect(
        templateService.canSpawn("self-driving", "planner", "grinder")
      ).toBe(true);
      expect(
        templateService.canSpawn("self-driving", "planner", "planner")
      ).toBe(true);
      expect(
        templateService.canSpawn("self-driving", "judge", "grinder")
      ).toBe(false);
      expect(
        templateService.canSpawn("self-driving", "grinder", "grinder")
      ).toBe(false);
    });

    it("allows all when no spawn rules exist", () => {
      teamService.create({ name: "no-rules" });

      expect(
        templateService.canSpawn("no-rules", "anyone", "anything")
      ).toBe(true);
    });
  });

  describe("getSpawnRules", () => {
    it("returns roles that a role can spawn", () => {
      templateService.bootstrapFromManifest(selfDrivingManifest);

      expect(
        templateService.getSpawnRules("self-driving", "planner")
      ).toEqual(["grinder", "planner"]);
      expect(
        templateService.getSpawnRules("self-driving", "judge")
      ).toEqual([]);
    });
  });

  describe("listSpawnRules", () => {
    it("returns all spawn rules for a team", () => {
      templateService.bootstrapFromManifest(selfDrivingManifest);

      const rules = templateService.listSpawnRules("self-driving");
      // Only planner has non-empty spawn targets stored in the DB
      expect(rules).toHaveLength(1);
      expect(rules[0].from).toBe("planner");
      expect(rules[0].canSpawn).toEqual(["grinder", "planner"]);
    });
  });

  describe("getTemplateInfo", () => {
    it("returns template info for a templated team", () => {
      templateService.bootstrapFromManifest(selfDrivingManifest);

      const info = templateService.getTemplateInfo("self-driving");
      expect(info!.templateName).toBe("self-driving");
    });

    it("returns null template info for non-templated team", () => {
      teamService.create({ name: "manual" });

      const info = templateService.getTemplateInfo("manual");
      expect(info!.templateName).toBeNull();
    });

    it("returns null for nonexistent team", () => {
      expect(templateService.getTemplateInfo("nope")).toBeNull();
    });
  });

  describe("structured team template (backward compat)", () => {
    it("bootstraps a traditional coordinator/worker structure", () => {
      const structured: TeamManifest = {
        name: "structured",
        description: "Traditional structured development",
        version: 1,
        roles: ["coordinator", "integrator", "worker", "monitor"],
        topology: {
          root: { role: "coordinator" },
          spawn_rules: {
            coordinator: ["worker", "integrator", "monitor"],
            integrator: ["worker"],
            worker: [],
            monitor: [],
          },
        },
        communication: {
          channels: {
            work: {
              signals: [
                "WORK_ASSIGNED",
                "WORKER_DONE",
                "MERGE_REQUEST",
                "MERGE_COMPLETE",
              ],
            },
          },
          subscriptions: {
            coordinator: [{ channel: "work" }],
            integrator: [
              {
                channel: "work",
                signals: ["MERGE_REQUEST", "WORKER_DONE"],
              },
            ],
            worker: [
              { channel: "work", signals: ["WORK_ASSIGNED"] },
            ],
          },
        },
      };

      const result = templateService.bootstrapFromManifest(structured);
      expect(result.team.name).toBe("structured");
      expect(result.roles).toHaveLength(4);

      expect(
        templateService.canSpawn("structured", "coordinator", "worker")
      ).toBe(true);
      expect(
        templateService.canSpawn("structured", "worker", "worker")
      ).toBe(false);

      const coordinatorSubs = commService.getSubscriptionsForRole(
        "structured",
        "coordinator"
      );
      expect(coordinatorSubs).toHaveLength(1);
      expect(coordinatorSubs[0].signal).toBeNull(); // all signals
    });
  });
});
