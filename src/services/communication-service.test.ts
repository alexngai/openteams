import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { CommunicationService } from "./communication-service";
import { TeamService } from "./team-service";
import type { CommunicationConfig } from "../template/types";

describe("CommunicationService", () => {
  let db: Database.Database;
  let commService: CommunicationService;
  let teamService: TeamService;

  const testConfig: CommunicationConfig = {
    channels: {
      task_updates: {
        description: "Task lifecycle events",
        signals: ["TASK_CREATED", "TASK_COMPLETED", "TASK_FAILED"],
      },
      work_coordination: {
        description: "Work assignment",
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
      judge: ["FIXUP_CREATED"],
      grinder: ["WORKER_DONE"],
    },
    routing: {
      status: "upstream",
      peers: [
        {
          from: "judge",
          to: "planner",
          via: "direct",
          signals: ["FIXUP_CREATED", "GREEN_SNAPSHOT"],
        },
        {
          from: "planner",
          to: "judge",
          via: "direct",
          signals: ["CONVERGENCE_CHECK"],
        },
      ],
    },
  };

  beforeEach(() => {
    db = createInMemoryDatabase();
    commService = new CommunicationService(db);
    teamService = new TeamService(db);
    teamService.create({ name: "test-team" });
  });

  afterEach(() => {
    db.close();
  });

  describe("applyConfig", () => {
    it("creates channels with their signals", () => {
      commService.applyConfig("test-team", testConfig);

      const channels = commService.listChannels("test-team");
      expect(channels).toHaveLength(2);

      const taskUpdates = channels.find((c) => c.name === "task_updates")!;
      expect(taskUpdates.description).toBe("Task lifecycle events");
      expect(taskUpdates.signals.sort()).toEqual([
        "TASK_COMPLETED",
        "TASK_CREATED",
        "TASK_FAILED",
      ]);

      const workCoord = channels.find(
        (c) => c.name === "work_coordination"
      )!;
      expect(workCoord.signals.sort()).toEqual(["WORKER_DONE", "WORK_ASSIGNED"].sort());
    });

    it("creates subscriptions", () => {
      commService.applyConfig("test-team", testConfig);

      const plannerSubs = commService.getSubscriptionsForRole(
        "test-team",
        "planner"
      );
      // planner: task_updates (all) + work_coordination (WORKER_DONE only)
      expect(plannerSubs).toHaveLength(2);
      const allSub = plannerSubs.find((s) => s.channel === "task_updates");
      expect(allSub!.signal).toBeNull(); // all signals

      const filtered = plannerSubs.find(
        (s) => s.channel === "work_coordination"
      );
      expect(filtered!.signal).toBe("WORKER_DONE");

      const judgeSubs = commService.getSubscriptionsForRole(
        "test-team",
        "judge"
      );
      expect(judgeSubs).toHaveLength(1);
      expect(judgeSubs[0].signal).toBe("TASK_FAILED");
    });

    it("creates emission permissions", () => {
      commService.applyConfig("test-team", testConfig);

      const plannerEmissions = commService.getEmissionsForRole(
        "test-team",
        "planner"
      );
      expect(plannerEmissions).toEqual(["TASK_CREATED", "WORK_ASSIGNED"]);

      const grinderEmissions = commService.getEmissionsForRole(
        "test-team",
        "grinder"
      );
      expect(grinderEmissions).toEqual(["WORKER_DONE"]);
    });

    it("creates peer routes", () => {
      commService.applyConfig("test-team", testConfig);

      const routes = commService.listPeerRoutes("test-team");
      expect(routes).toHaveLength(2);

      const judgeToPlanner = routes.find((r) => r.from_role === "judge")!;
      expect(judgeToPlanner.to_role).toBe("planner");
      expect(judgeToPlanner.via).toBe("direct");
      expect(judgeToPlanner.signals).toEqual([
        "FIXUP_CREATED",
        "GREEN_SNAPSHOT",
      ]);
    });

    it("is idempotent for channels and signals", () => {
      commService.applyConfig("test-team", testConfig);
      commService.applyConfig("test-team", testConfig);

      const channels = commService.listChannels("test-team");
      expect(channels).toHaveLength(2);
    });
  });

  describe("channels", () => {
    it("getChannel returns a specific channel", () => {
      commService.applyConfig("test-team", testConfig);

      const ch = commService.getChannel("test-team", "task_updates");
      expect(ch).not.toBeNull();
      expect(ch!.signals).toContain("TASK_CREATED");
    });

    it("getChannel returns null for nonexistent", () => {
      expect(commService.getChannel("test-team", "nope")).toBeNull();
    });
  });

  describe("emissions", () => {
    it("canEmit returns true for declared emissions", () => {
      commService.applyConfig("test-team", testConfig);

      expect(
        commService.canEmit("test-team", "planner", "TASK_CREATED")
      ).toBe(true);
      expect(
        commService.canEmit("test-team", "grinder", "WORKER_DONE")
      ).toBe(true);
    });

    it("canEmit returns false for undeclared emissions", () => {
      commService.applyConfig("test-team", testConfig);

      expect(
        commService.canEmit("test-team", "grinder", "TASK_CREATED")
      ).toBe(false);
    });

    it("canEmit returns true when no emissions are declared (permissive)", () => {
      // No config applied — permissive mode
      expect(
        commService.canEmit("test-team", "anyone", "ANYTHING")
      ).toBe(true);
    });
  });

  describe("peer routes", () => {
    it("getPeerRoutesForRole returns routes from a role", () => {
      commService.applyConfig("test-team", testConfig);

      const routes = commService.getPeerRoutesForRole(
        "test-team",
        "judge"
      );
      expect(routes).toHaveLength(1);
      expect(routes[0].to_role).toBe("planner");
    });

    it("returns empty for roles with no peer routes", () => {
      commService.applyConfig("test-team", testConfig);

      const routes = commService.getPeerRoutesForRole(
        "test-team",
        "grinder"
      );
      expect(routes).toHaveLength(0);
    });
  });

  describe("signal events", () => {
    it("emits and retrieves signal events", () => {
      commService.applyConfig("test-team", testConfig);

      const { event, permitted, enforcement } = commService.emit({
        teamName: "test-team",
        channel: "task_updates",
        signal: "TASK_CREATED",
        sender: "planner",
        payload: { taskId: 1, subject: "Fix bug" },
      });

      expect(event.id).toBeGreaterThan(0);
      expect(event.channel).toBe("task_updates");
      expect(event.signal).toBe("TASK_CREATED");
      expect(event.sender).toBe("planner");
      expect(permitted).toBe(true);
      expect(enforcement).toBe("permissive");
    });

    it("lists events with filters", () => {
      commService.emit({
        teamName: "test-team",
        channel: "task_updates",
        signal: "TASK_CREATED",
        sender: "planner",
      });
      commService.emit({
        teamName: "test-team",
        channel: "work_coordination",
        signal: "WORKER_DONE",
        sender: "grinder",
      });

      const all = commService.listEvents("test-team");
      expect(all).toHaveLength(2);

      const filtered = commService.listEvents("test-team", {
        channel: "task_updates",
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].signal).toBe("TASK_CREATED");

      const bySender = commService.listEvents("test-team", {
        sender: "grinder",
      });
      expect(bySender).toHaveLength(1);
    });

    it("getEventsForRole returns subscription-filtered events", () => {
      commService.applyConfig("test-team", testConfig);

      // Planner emits
      commService.emit({
        teamName: "test-team",
        channel: "task_updates",
        signal: "TASK_CREATED",
        sender: "planner",
      });
      commService.emit({
        teamName: "test-team",
        channel: "task_updates",
        signal: "TASK_FAILED",
        sender: "system",
      });
      commService.emit({
        teamName: "test-team",
        channel: "work_coordination",
        signal: "WORKER_DONE",
        sender: "grinder",
      });
      commService.emit({
        teamName: "test-team",
        channel: "work_coordination",
        signal: "WORK_ASSIGNED",
        sender: "planner",
      });

      // Planner subscribes to: task_updates (all → 2 events) + work_coordination:WORKER_DONE (1 event)
      const plannerEvents = commService.getEventsForRole(
        "test-team",
        "planner"
      );
      expect(plannerEvents).toHaveLength(3);

      // Judge subscribes to: task_updates (TASK_FAILED only)
      const judgeEvents = commService.getEventsForRole(
        "test-team",
        "judge"
      );
      expect(judgeEvents).toHaveLength(1);
      expect(judgeEvents[0].signal).toBe("TASK_FAILED");

      // Grinder subscribes to: work_coordination (WORK_ASSIGNED only)
      const grinderEvents = commService.getEventsForRole(
        "test-team",
        "grinder"
      );
      expect(grinderEvents).toHaveLength(1);
      expect(grinderEvents[0].signal).toBe("WORK_ASSIGNED");
    });

    it("getEventsForRole deduplicates overlapping subscriptions", () => {
      // Apply config where planner gets all of task_updates
      commService.applyConfig("test-team", testConfig);

      commService.emit({
        teamName: "test-team",
        channel: "task_updates",
        signal: "TASK_CREATED",
        sender: "planner",
      });

      // Planner subscribes to full task_updates — should see this event once, not duplicated
      const events = commService.getEventsForRole("test-team", "planner");
      const ids = events.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
    });
  });

  describe("enforcement", () => {
    it("defaults to permissive enforcement", () => {
      expect(commService.getEnforcement("test-team")).toBe("permissive");
    });

    it("stores enforcement mode from config", () => {
      const strictConfig: CommunicationConfig = {
        ...testConfig,
        enforcement: "strict",
      };
      commService.applyConfig("test-team", strictConfig);
      expect(commService.getEnforcement("test-team")).toBe("strict");
    });

    it("strict mode throws on unauthorized emission", () => {
      const strictConfig: CommunicationConfig = {
        ...testConfig,
        enforcement: "strict",
      };
      commService.applyConfig("test-team", strictConfig);

      // grinder is not permitted to emit TASK_CREATED
      expect(() =>
        commService.emit({
          teamName: "test-team",
          channel: "task_updates",
          signal: "TASK_CREATED",
          sender: "grinder",
        })
      ).toThrow('not permitted to emit signal "TASK_CREATED"');
    });

    it("strict mode allows authorized emission", () => {
      const strictConfig: CommunicationConfig = {
        ...testConfig,
        enforcement: "strict",
      };
      commService.applyConfig("test-team", strictConfig);

      // planner IS permitted to emit TASK_CREATED
      const { event, permitted } = commService.emit({
        teamName: "test-team",
        channel: "task_updates",
        signal: "TASK_CREATED",
        sender: "planner",
      });
      expect(event.id).toBeGreaterThan(0);
      expect(permitted).toBe(true);
    });

    it("audit mode allows but flags unauthorized emission", () => {
      const auditConfig: CommunicationConfig = {
        ...testConfig,
        enforcement: "audit",
      };
      commService.applyConfig("test-team", auditConfig);

      // grinder is not permitted, but audit mode allows it
      const { event, permitted, enforcement } = commService.emit({
        teamName: "test-team",
        channel: "task_updates",
        signal: "TASK_CREATED",
        sender: "grinder",
      });
      expect(event.id).toBeGreaterThan(0);
      expect(permitted).toBe(false);
      expect(enforcement).toBe("audit");
    });

    it("permissive mode allows all emissions", () => {
      commService.applyConfig("test-team", testConfig); // default permissive

      const { event, permitted } = commService.emit({
        teamName: "test-team",
        channel: "task_updates",
        signal: "TASK_CREATED",
        sender: "grinder",
      });
      expect(event.id).toBeGreaterThan(0);
      // canEmit returns false (grinder not listed), but permissive allows it
      expect(permitted).toBe(false);
    });
  });
});
