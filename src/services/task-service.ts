import type Database from "better-sqlite3";
import type {
  Task,
  TaskRow,
  TaskSummary,
  CreateTaskOptions,
  UpdateTaskOptions,
  TaskStatus,
} from "../types";

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export class TaskService {
  constructor(private db: Database.Database) {}

  create(options: CreateTaskOptions): Task {
    const result = this.db
      .prepare(
        `INSERT INTO tasks (team_name, subject, description, active_form, metadata)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        options.teamName,
        options.subject,
        options.description,
        options.activeForm ?? null,
        JSON.stringify(options.metadata ?? {})
      );

    const taskId = Number(result.lastInsertRowid);

    if (options.blockedBy && options.blockedBy.length > 0) {
      const insertDep = this.db.prepare(
        "INSERT INTO task_deps (task_id, blocked_by) VALUES (?, ?)"
      );
      for (const depId of options.blockedBy) {
        insertDep.run(taskId, depId);
      }
    }

    return this.get(options.teamName, taskId)!;
  }

  get(teamName: string, taskId: number): Task | null {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ? AND team_name = ?")
      .get(taskId, teamName) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  list(
    teamName: string,
    filters?: { status?: TaskStatus; owner?: string }
  ): TaskSummary[] {
    let sql = "SELECT id, subject, status, owner FROM tasks WHERE team_name = ? AND status != 'deleted'";
    const params: any[] = [teamName];

    if (filters?.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    }
    if (filters?.owner) {
      sql += " AND owner = ?";
      params.push(filters.owner);
    }

    sql += " ORDER BY id ASC";

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      subject: string;
      status: TaskStatus;
      owner: string | null;
    }>;

    return rows.map((row) => ({
      ...row,
      blockedBy: this.getBlockedBy(row.id),
    }));
  }

  update(teamName: string, taskId: number, options: UpdateTaskOptions): Task {
    const task = this.get(teamName, taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found in team "${teamName}"`);
    }

    const sets: string[] = [];
    const params: any[] = [];

    if (options.status !== undefined) {
      sets.push("status = ?");
      params.push(options.status);
    }
    if (options.subject !== undefined) {
      sets.push("subject = ?");
      params.push(options.subject);
    }
    if (options.description !== undefined) {
      sets.push("description = ?");
      params.push(options.description);
    }
    if (options.activeForm !== undefined) {
      sets.push("active_form = ?");
      params.push(options.activeForm);
    }
    if (options.owner !== undefined) {
      sets.push("owner = ?");
      params.push(options.owner);
    }
    if (options.metadata !== undefined) {
      const merged = { ...task.metadata, ...options.metadata };
      // Remove keys set to null
      for (const [k, v] of Object.entries(merged)) {
        if (v === null) delete merged[k];
      }
      sets.push("metadata = ?");
      params.push(JSON.stringify(merged));
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      params.push(taskId, teamName);
      this.db
        .prepare(
          `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND team_name = ?`
        )
        .run(...params);
    }

    if (options.addBlockedBy && options.addBlockedBy.length > 0) {
      const insertDep = this.db.prepare(
        "INSERT OR IGNORE INTO task_deps (task_id, blocked_by) VALUES (?, ?)"
      );
      for (const depId of options.addBlockedBy) {
        insertDep.run(taskId, depId);
      }
    }

    if (options.addBlocks && options.addBlocks.length > 0) {
      const insertDep = this.db.prepare(
        "INSERT OR IGNORE INTO task_deps (task_id, blocked_by) VALUES (?, ?)"
      );
      for (const blockedTaskId of options.addBlocks) {
        insertDep.run(blockedTaskId, taskId);
      }
    }

    return this.get(teamName, taskId)!;
  }

  getBlockedBy(taskId: number): number[] {
    const rows = this.db
      .prepare("SELECT blocked_by FROM task_deps WHERE task_id = ?")
      .all(taskId) as Array<{ blocked_by: number }>;
    return rows.map((r) => r.blocked_by);
  }

  getBlocks(taskId: number): number[] {
    const rows = this.db
      .prepare("SELECT task_id FROM task_deps WHERE blocked_by = ?")
      .all(taskId) as Array<{ task_id: number }>;
    return rows.map((r) => r.task_id);
  }

  isBlocked(taskId: number): boolean {
    const deps = this.getBlockedBy(taskId);
    if (deps.length === 0) return false;

    const placeholders = deps.map(() => "?").join(",");
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM tasks WHERE id IN (${placeholders}) AND status != 'completed'`
      )
      .get(...deps) as { count: number };

    return row.count > 0;
  }
}
