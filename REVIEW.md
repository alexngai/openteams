# OpenTeams Codebase Review

## Summary

OpenTeams is a well-structured TypeScript CLI tool for multi-agent team coordination. The layered architecture (CLI -> Service -> Database + Spawner) is clean, the type system is consistent, all 183 tests pass, and the TypeScript strict mode compilation is error-free. The template system and communication topology are the most ambitious parts of the design and are well-conceived.

That said, there are meaningful gaps between what the design promises and what the implementation currently delivers. This review organizes them by severity.

---

## Critical Gaps

### 1. Schema Migration Has No Upgrade Path

**Location:** `src/db/database.ts:6-159`

The database uses `SCHEMA_VERSION = 2` and stores this in a `schema_version` table. However, there is no migration logic. The code checks whether a version row exists, and if not, inserts `2`. All tables use `CREATE TABLE IF NOT EXISTS`, which means:

- If a database was created at schema v1 (before communication tables, `template_name`/`template_path`/`role` columns), upgrading the code to v2 will **silently fail** to add the new columns and tables.
- The existing v1 tables won't be altered, and the version row remains at `1`.
- Queries referencing new columns will crash at runtime with cryptic SQLite errors.

**Recommendation:** Implement actual migration logic that reads the current version and applies `ALTER TABLE` / `CREATE TABLE` statements incrementally (v1 -> v2, v2 -> v3, etc.).

### 2. Communication Enforcement is Declared but Never Applied

**Location:** `src/template/types.ts:45`, `src/services/communication-service.ts`

The `CommunicationConfig` type defines an `enforcement` field with three modes: `"strict"`, `"permissive"`, and `"audit"`. However:

- `CommunicationService.applyConfig()` ignores the enforcement setting entirely -- it is not stored in the database.
- `CommunicationService.emit()` writes signal events **without checking emission permissions**.
- `canEmit()` exists and works correctly, but it is **never called** from `emit()` or from the `template emit` CLI command.
- There is no audit logging when enforcement mode would indicate it.

This means the entire enforcement mechanism is inert. A role without emission permissions can emit any signal, and no warnings or errors are produced.

**Recommendation:** Store the enforcement mode in the database (new column on `teams` or a separate config table). Check `canEmit()` in `emit()` and apply the correct behavior: throw in strict mode, log in audit mode, allow in permissive mode.

### 3. Role Inheritance (`extends`) is Unimplemented

**Location:** `src/template/loader.ts:203-227`

The `RoleDefinition` type supports `extends` (role B extends role A) and `CapabilityComposition` (add/remove capabilities). However:

- `resolveRole()` has a comment "resolve against parent later if extends is used" but this resolution **never happens**.
- If role B declares `extends: A`, the capabilities from role A are never merged into B.
- The `remove` list in `CapabilityComposition` is tracked in `raw` but never applied.

Templates that rely on role inheritance will silently produce incorrect capability lists.

**Recommendation:** After all roles are loaded, run a second pass to resolve inheritance chains. Apply the `add`/`remove` capability composition against the parent role's capabilities.

---

## Significant Gaps

### 4. ACPFactorySpawner Ignores `agentType`

**Location:** `src/spawner/acp-factory.ts:29-33`

The CLI exposes `--type` with options `bash`, `general-purpose`, `explore`, `plan`. The `SpawnAgentOptions.agentType` field carries this value. However, `ACPFactorySpawner.spawn()` uses only `options.model ?? "claude-code"` as the agent provider and **completely ignores** `options.agentType`.

The agent type is stored in the database for display purposes but has no effect on the spawned agent's behavior.

**Recommendation:** Map `agentType` to the appropriate ACP provider parameter or session configuration. If the ACP protocol doesn't support this distinction, document it clearly.

### 5. No Team Existence Validation in TaskService and MessageService

**Location:** `src/services/task-service.ts`, `src/services/message-service.ts`

`TaskService.create()` does not verify the team exists before inserting a task. The foreign key constraint catches this at the database level, but the error message is a raw SQLite constraint violation rather than a user-friendly message like `Team "foo" not found`.

The same applies to all `MessageService` methods (`send()`, `broadcast()`, `sendShutdownRequest()`, etc.) -- none validate team existence.

**Recommendation:** Add team existence checks in create/send methods with descriptive error messages, consistent with how `AgentService` and `TeamService.addMember()` already do it.

### 6. `listForAgent` Returns Duplicate Broadcasts

**Location:** `src/services/message-service.ts:124-134`

The query:
```sql
WHERE team_name = ? AND (recipient = ? OR sender = ? OR type = 'broadcast')
```

The condition `type = 'broadcast'` returns **all** broadcast messages for the team regardless of recipient. Since broadcasts are stored as individual rows per recipient (one per non-shutdown member), querying for agent X will return:
- Broadcast messages addressed to X (via `recipient = ?`)
- **Plus** all other broadcast messages addressed to other agents (via `type = 'broadcast'`)

This produces duplicates for broadcasts addressed to the queried agent and irrelevant broadcasts for other agents.

**Recommendation:** Remove the `OR type = 'broadcast'` clause. Broadcasts addressed to a specific agent already have that agent as `recipient`, so `recipient = ?` catches them correctly.

### 7. Missing CLI Commands for Message Response Types

**Location:** `src/cli/message.ts`

The `MessageService` supports `sendShutdownResponse()` and `sendPlanApprovalResponse()`, but the CLI has no commands for these. An agent that receives a shutdown request via CLI cannot respond via CLI. Similarly, plan approval workflows can't be completed through the CLI.

**Recommendation:** Add `openteams message shutdown-response` and `openteams message plan-approval` CLI commands.

### 8. Undelivered Message System Not Surfaced

**Location:** `src/services/message-service.ts:146-162`

`getUndelivered()` and `markDelivered()` exist in the service layer but are completely absent from the CLI. There is no way to:
- Poll for new/undelivered messages (`openteams message poll <team> --agent <name>`)
- Mark a message as delivered after reading it
- Distinguish read from unread messages in `message list`

Since message delivery tracking is a key coordination primitive for asynchronous agent workflows, this is a significant functional gap.

**Recommendation:** Add `openteams message poll` (undelivered messages) and `openteams message ack <id>` (mark delivered) commands. Consider showing delivery status in `message list`.

### 9. No JSON Output Mode

**Location:** All CLI commands in `src/cli/`

All CLI output is human-readable text formatted with `console.log()`. There is no `--json` or `--output json` flag. Since this tool is explicitly designed for **agent-to-agent** coordination (agents will parse CLI output), structured output is important.

Currently, any agent consuming openteams output must parse free-form text strings like `Task #3 created: Design API` or `Agent "worker" spawned in team "dev" (id: acp-123)`.

**Recommendation:** Add a global `--json` flag that switches all command output to structured JSON. This is high-value for the agent-as-consumer use case.

### 10. No CLI Command to Add Members Without Spawning

**Location:** `src/cli/agent.ts`, `src/services/team-service.ts`

`TeamService.addMember()` exists and supports adding members with metadata (role, agent type, model). However, the only CLI path to add a member is `openteams agent spawn`, which requires actually spawning an agent via the spawner.

There is no way to register an external agent that is managed outside of openteams (e.g., an agent spawned by another system, or a human operator taking a role).

**Recommendation:** Add `openteams team add-member <team> <name> [--role <role>] [--type <type>]` command.

---

## Minor Gaps

### 11. Task Dependency Cycle Detection is Missing

**Location:** `src/services/task-service.ts:136-153`

The task system allows creating circular dependencies:
```
Task 1 blocked by Task 2
Task 2 blocked by Task 1
```

Both tasks become permanently blocked with no warning. The `isBlocked()` check will correctly report both as blocked, but there's no way to detect or prevent the cycle.

**Recommendation:** Add cycle detection in `update()` when adding new `blockedBy` or `blocks` edges. A simple DFS/BFS from the target back to the source is sufficient.

### 12. No Sender Membership Validation in Messaging

**Location:** `src/cli/message.ts:15-16`

The `--from` flag defaults to `"lead"` for all message commands. There is no validation that:
- The sender is a member of the team
- The recipient is a member of the team
- The sender has the correct status (not shutdown)

Any arbitrary string works as a sender or recipient. This could lead to orphaned messages that no agent will ever retrieve.

**Recommendation:** At minimum, validate that sender and recipient exist as team members. Consider making sender validation opt-in to support external/system senders.

### 13. Signal Event Payloads Not Parsed Consistently

**Location:** `src/services/communication-service.ts:278`, `src/template/types.ts:115-123`

`SignalEvent.payload` is typed as `string` (raw JSON). Events returned from `listEvents()` and `getEventsForRole()` return the raw string without parsing. This is inconsistent with `TaskService`, where `rowToTask()` parses `metadata` from JSON string to object.

**Recommendation:** Either parse payload to an object in the service layer (like task metadata) or clarify in the type that it's a JSON string. Currently the type says `string` but the semantic expectation is structured data.

### 14. `index.ts` Exports `ACPFactorySpawner` Unconditionally

**Location:** `src/index.ts:87`

`ACPFactorySpawner` is exported directly from the library's public API, but `acp-factory` is an optional dependency. Any consumer that imports `ACPFactorySpawner` from `"openteams"` will get a runtime error if `acp-factory` is not installed.

The CLI handles this with a try/catch in `loadSpawner()`, but library consumers are not protected.

**Recommendation:** Either make the export lazy (factory function that throws a clear error) or document that `ACPFactorySpawner` requires installing `acp-factory` as a peer dependency.

### 15. `design.md` Is Out of Date

**Location:** `design.md`

The design document reflects an earlier state of the project:
- The database schema section is missing `template_name`, `template_path` columns on `teams`, the `role` column on `members`, and all communication tables.
- The architecture diagram doesn't mention `TemplateService`, `CommunicationService`, or generators.
- The file structure section is missing `src/generators/`, `src/template/`, and `src/cli/generate.ts`.
- The CLI commands section is missing `template` and `generate` subcommands.

**Recommendation:** Update `design.md` to reflect the current implementation, or mark it as potentially outdated and point readers to `SKILL.md`.

### 16. Missing `engines` Field in `package.json`

**Location:** `package.json`

The code uses `crypto.randomUUID()` (Node 19+), ES2022 target features, and `better-sqlite3` which requires native compilation. There is no `engines` field to communicate the minimum Node.js version requirement.

**Recommendation:** Add `"engines": { "node": ">=19.0.0" }` (or >=18 with appropriate polyfills).

### 17. Template Bootstrap Doesn't Populate Team Members

**Location:** `src/services/template-service.ts:28-81`

When `TemplateService.bootstrap()` creates a team from a template, it stores roles, communication topology, and spawn rules, but it **does not add any members** to the team. The roles list exists only in the bootstrap result object.

There is no automated path from "template defines 12 roles" to "team has 12 registered members." The root and companion roles from the topology are not pre-registered either.

**Recommendation:** Consider auto-registering at least the root and companion roles as members (with status "idle") during bootstrap, since these are the starting agents that need to exist before spawning others.

### 18. Global Spawner Interface Disconnected From CLI

**Location:** `src/spawner/interface.ts`, `src/cli.ts`

The `setSpawner()`/`getSpawner()` global singleton pattern in `src/spawner/interface.ts` is exported from the library API but is **not used by the CLI**. The CLI creates its own spawner instance in `loadSpawner()` and passes it directly to `createAgentCommands()`.

This means:
- A library consumer calling `setSpawner()` has no effect on the CLI.
- The global spawner is a separate code path from the CLI spawner.

**Recommendation:** Either wire the CLI to use `getSpawner()` (so `setSpawner()` is the single configuration point) or remove the global interface and let consumers manage spawner instances directly.

---

## Observations (Not Gaps)

These are architectural observations, not necessarily problems:

1. **Task IDs are globally auto-incremented**, not per-team. A team's tasks might be #1, #2, #5, #12 if other teams created tasks in between. This is fine for database integrity but can be confusing in a multi-team CLI workflow.

2. **Soft deletes are consistent** across teams and tasks. The pattern is well-applied.

3. **The test suite is comprehensive** (183 tests across 12 files) with good coverage of service layer logic, template loading, and edge cases.

4. **The template system is the most distinctive feature** and well-designed for interoperability. The YAML schema, JSON Schema validation files, and the separation of roles/prompts/manifest are good.

5. **No CI/CD or linting** is configured. For a v0.1 project this is acceptable but should be added before wider distribution.
