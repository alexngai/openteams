import { Command } from "commander";
import { TaskService } from "../services/task-service";
import type Database from "better-sqlite3";
import type { TaskStatus } from "../types";

function parseCommaSeparatedInts(val: string): number[] {
  return val.split(",").map((s) => {
    const n = parseInt(s.trim(), 10);
    if (isNaN(n)) throw new Error(`Invalid task ID: "${s.trim()}"`);
    return n;
  });
}

export function createTaskCommands(db: Database.Database): Command {
  const taskService = new TaskService(db);
  const task = new Command("task").description("Manage tasks");

  task
    .command("create <team>")
    .description("Create a new task")
    .requiredOption("-s, --subject <subject>", "Task subject")
    .requiredOption("-d, --description <description>", "Task description")
    .option("-a, --active-form <text>", "Present continuous form for display")
    .option("--blocked-by <ids>", "Comma-separated task IDs that block this task")
    .option("--metadata <json>", "JSON metadata object")
    .action((team: string, opts) => {
      try {
        const result = taskService.create({
          teamName: team,
          subject: opts.subject,
          description: opts.description,
          activeForm: opts.activeForm,
          blockedBy: opts.blockedBy
            ? parseCommaSeparatedInts(opts.blockedBy)
            : undefined,
          metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
        });
        console.log(`Task #${result.id} created: ${result.subject}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  task
    .command("list <team>")
    .description("List tasks for a team")
    .option("--status <status>", "Filter by status")
    .option("--owner <name>", "Filter by owner")
    .action((team: string, opts) => {
      const tasks = taskService.list(team, {
        status: opts.status as TaskStatus | undefined,
        owner: opts.owner,
      });
      if (tasks.length === 0) {
        console.log("No tasks found.");
        return;
      }
      for (const t of tasks) {
        const owner = t.owner ? ` (${t.owner})` : "";
        const blocked =
          t.blockedBy.length > 0
            ? ` [blocked by: ${t.blockedBy.join(", ")}]`
            : "";
        console.log(`  #${t.id} [${t.status}]${owner} ${t.subject}${blocked}`);
      }
    });

  task
    .command("get <team> <task-id>")
    .description("Get full task details")
    .action((team: string, taskId: string) => {
      const id = parseInt(taskId, 10);
      const t = taskService.get(team, id);
      if (!t) {
        console.error(`Error: Task #${id} not found in team "${team}".`);
        process.exitCode = 1;
        return;
      }
      console.log(`Task #${t.id}: ${t.subject}`);
      console.log(`Status: ${t.status}`);
      if (t.owner) console.log(`Owner: ${t.owner}`);
      if (t.active_form) console.log(`Active Form: ${t.active_form}`);
      console.log(`Description: ${t.description}`);

      const blockedBy = taskService.getBlockedBy(t.id);
      if (blockedBy.length > 0) {
        console.log(`Blocked By: ${blockedBy.join(", ")}`);
      }
      const blocks = taskService.getBlocks(t.id);
      if (blocks.length > 0) {
        console.log(`Blocks: ${blocks.join(", ")}`);
      }

      if (Object.keys(t.metadata).length > 0) {
        console.log(`Metadata: ${JSON.stringify(t.metadata)}`);
      }
      console.log(`Created: ${t.created_at}`);
      console.log(`Updated: ${t.updated_at}`);
    });

  task
    .command("update <team> <task-id>")
    .description("Update a task")
    .option("--status <status>", "New status (pending, in_progress, completed, deleted)")
    .option("--owner <name>", "Assign to agent")
    .option("-s, --subject <subject>", "New subject")
    .option("-d, --description <description>", "New description")
    .option("-a, --active-form <text>", "New active form text")
    .option("--add-blocks <ids>", "Task IDs this task blocks")
    .option("--add-blocked-by <ids>", "Task IDs that block this task")
    .option("--metadata <json>", "JSON metadata to merge")
    .action((team: string, taskId: string, opts) => {
      try {
        const id = parseInt(taskId, 10);
        const result = taskService.update(team, id, {
          status: opts.status as TaskStatus | undefined,
          owner: opts.owner,
          subject: opts.subject,
          description: opts.description,
          activeForm: opts.activeForm,
          addBlocks: opts.addBlocks
            ? parseCommaSeparatedInts(opts.addBlocks)
            : undefined,
          addBlockedBy: opts.addBlockedBy
            ? parseCommaSeparatedInts(opts.addBlockedBy)
            : undefined,
          metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
        });
        console.log(`Task #${result.id} updated: [${result.status}] ${result.subject}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return task;
}
