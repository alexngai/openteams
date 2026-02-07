import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createInMemoryDatabase } from "../db/database";
import { TaskService } from "./task-service";
import { TeamService } from "./team-service";

describe("TaskService", () => {
  let db: Database.Database;
  let taskService: TaskService;
  let teamService: TeamService;

  beforeEach(() => {
    db = createInMemoryDatabase();
    taskService = new TaskService(db);
    teamService = new TeamService(db);
    teamService.create({ name: "test-team" });
  });

  afterEach(() => {
    db.close();
  });

  describe("create", () => {
    it("creates a task with required fields", () => {
      const task = taskService.create({
        teamName: "test-team",
        subject: "Fix bug",
        description: "There is a bug in auth",
      });
      expect(task.id).toBeGreaterThan(0);
      expect(task.subject).toBe("Fix bug");
      expect(task.description).toBe("There is a bug in auth");
      expect(task.status).toBe("pending");
      expect(task.owner).toBeNull();
    });

    it("creates a task with all optional fields", () => {
      const task = taskService.create({
        teamName: "test-team",
        subject: "Add feature",
        description: "Add dark mode",
        activeForm: "Adding dark mode",
        metadata: { priority: "high" },
      });
      expect(task.active_form).toBe("Adding dark mode");
      expect(task.metadata).toEqual({ priority: "high" });
    });

    it("creates a task with blockedBy dependencies", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "Task 1",
        description: "First task",
      });
      const t2 = taskService.create({
        teamName: "test-team",
        subject: "Task 2",
        description: "Depends on task 1",
        blockedBy: [t1.id],
      });
      const blockedBy = taskService.getBlockedBy(t2.id);
      expect(blockedBy).toEqual([t1.id]);
    });
  });

  describe("get", () => {
    it("returns null for nonexistent task", () => {
      expect(taskService.get("test-team", 999)).toBeNull();
    });

    it("returns the task with parsed metadata", () => {
      const created = taskService.create({
        teamName: "test-team",
        subject: "Test",
        description: "Desc",
        metadata: { key: "value" },
      });
      const task = taskService.get("test-team", created.id);
      expect(task).not.toBeNull();
      expect(task!.metadata).toEqual({ key: "value" });
    });
  });

  describe("list", () => {
    it("returns empty array when no tasks", () => {
      expect(taskService.list("test-team")).toEqual([]);
    });

    it("returns task summaries with blockedBy", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "Task 1",
        description: "D1",
      });
      taskService.create({
        teamName: "test-team",
        subject: "Task 2",
        description: "D2",
        blockedBy: [t1.id],
      });

      const list = taskService.list("test-team");
      expect(list).toHaveLength(2);
      expect(list[0].blockedBy).toEqual([]);
      expect(list[1].blockedBy).toEqual([t1.id]);
    });

    it("filters by status", () => {
      taskService.create({
        teamName: "test-team",
        subject: "Pending",
        description: "D",
      });
      const t2 = taskService.create({
        teamName: "test-team",
        subject: "Done",
        description: "D",
      });
      taskService.update("test-team", t2.id, { status: "completed" });

      const pending = taskService.list("test-team", { status: "pending" });
      expect(pending).toHaveLength(1);
      expect(pending[0].subject).toBe("Pending");
    });

    it("filters by owner", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "Mine",
        description: "D",
      });
      taskService.create({
        teamName: "test-team",
        subject: "Yours",
        description: "D",
      });
      taskService.update("test-team", t1.id, { owner: "alice" });

      const list = taskService.list("test-team", { owner: "alice" });
      expect(list).toHaveLength(1);
      expect(list[0].subject).toBe("Mine");
    });

    it("excludes deleted tasks", () => {
      const t = taskService.create({
        teamName: "test-team",
        subject: "Gone",
        description: "D",
      });
      taskService.update("test-team", t.id, { status: "deleted" });
      expect(taskService.list("test-team")).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("updates status", () => {
      const t = taskService.create({
        teamName: "test-team",
        subject: "Task",
        description: "D",
      });
      const updated = taskService.update("test-team", t.id, {
        status: "in_progress",
      });
      expect(updated.status).toBe("in_progress");
    });

    it("updates owner", () => {
      const t = taskService.create({
        teamName: "test-team",
        subject: "Task",
        description: "D",
      });
      const updated = taskService.update("test-team", t.id, {
        owner: "bob",
      });
      expect(updated.owner).toBe("bob");
    });

    it("updates subject and description", () => {
      const t = taskService.create({
        teamName: "test-team",
        subject: "Old",
        description: "Old desc",
      });
      const updated = taskService.update("test-team", t.id, {
        subject: "New",
        description: "New desc",
      });
      expect(updated.subject).toBe("New");
      expect(updated.description).toBe("New desc");
    });

    it("merges metadata and removes null keys", () => {
      const t = taskService.create({
        teamName: "test-team",
        subject: "Task",
        description: "D",
        metadata: { a: 1, b: 2 },
      });
      const updated = taskService.update("test-team", t.id, {
        metadata: { b: null, c: 3 } as any,
      });
      expect(updated.metadata).toEqual({ a: 1, c: 3 });
    });

    it("adds blockedBy dependencies", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "T1",
        description: "D",
      });
      const t2 = taskService.create({
        teamName: "test-team",
        subject: "T2",
        description: "D",
      });
      taskService.update("test-team", t2.id, { addBlockedBy: [t1.id] });
      expect(taskService.getBlockedBy(t2.id)).toEqual([t1.id]);
    });

    it("adds blocks dependencies", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "T1",
        description: "D",
      });
      const t2 = taskService.create({
        teamName: "test-team",
        subject: "T2",
        description: "D",
      });
      taskService.update("test-team", t1.id, { addBlocks: [t2.id] });
      expect(taskService.getBlockedBy(t2.id)).toEqual([t1.id]);
      expect(taskService.getBlocks(t1.id)).toEqual([t2.id]);
    });

    it("throws for nonexistent task", () => {
      expect(() =>
        taskService.update("test-team", 999, { status: "completed" })
      ).toThrow("Task 999 not found");
    });
  });

  describe("dependencies", () => {
    it("getBlockedBy returns blocking task ids", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "T1",
        description: "D",
      });
      const t2 = taskService.create({
        teamName: "test-team",
        subject: "T2",
        description: "D",
      });
      const t3 = taskService.create({
        teamName: "test-team",
        subject: "T3",
        description: "D",
        blockedBy: [t1.id, t2.id],
      });
      expect(taskService.getBlockedBy(t3.id)).toEqual([t1.id, t2.id]);
    });

    it("getBlocks returns tasks this task blocks", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "T1",
        description: "D",
      });
      taskService.create({
        teamName: "test-team",
        subject: "T2",
        description: "D",
        blockedBy: [t1.id],
      });
      taskService.create({
        teamName: "test-team",
        subject: "T3",
        description: "D",
        blockedBy: [t1.id],
      });
      const blocks = taskService.getBlocks(t1.id);
      expect(blocks).toHaveLength(2);
    });

    it("isBlocked returns true when dependencies are not completed", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "T1",
        description: "D",
      });
      const t2 = taskService.create({
        teamName: "test-team",
        subject: "T2",
        description: "D",
        blockedBy: [t1.id],
      });
      expect(taskService.isBlocked(t2.id)).toBe(true);
    });

    it("isBlocked returns false when all dependencies are completed", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "T1",
        description: "D",
      });
      const t2 = taskService.create({
        teamName: "test-team",
        subject: "T2",
        description: "D",
        blockedBy: [t1.id],
      });
      taskService.update("test-team", t1.id, { status: "completed" });
      expect(taskService.isBlocked(t2.id)).toBe(false);
    });

    it("isBlocked returns false when no dependencies", () => {
      const t1 = taskService.create({
        teamName: "test-team",
        subject: "T1",
        description: "D",
      });
      expect(taskService.isBlocked(t1.id)).toBe(false);
    });
  });
});
