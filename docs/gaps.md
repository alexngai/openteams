# OpenTeams Implementation Gaps & Remediation Plan

This document expands on each gap identified in the codebase review, proposes a concrete implementation plan, estimates scope, and suggests prioritization for addressing them.

---

## Critical Gaps

### Gap 1: Schema Migration Has No Upgrade Path

**Problem:**
`src/db/database.ts` uses `CREATE TABLE IF NOT EXISTS` for all tables and stores `SCHEMA_VERSION = 2`, but there is no logic to migrate an existing v1 database to v2. If a user created a database before communication tables and template columns were added, upgrading the code will silently leave the database missing those structures. All queries referencing the new columns will fail at runtime.

**What currently happens:**
```
User installs v1 → creates DB with teams, members, tasks, messages
User upgrades to v2 → code runs CREATE TABLE IF NOT EXISTS → existing tables unchanged
→ channels, subscriptions, emissions, peer_routes, etc. are created (new tables)
→ BUT: teams table is missing template_name, template_path columns
→ BUT: members table is missing role column
→ schema_version row still says 1 (INSERT only runs if row is missing)
```

**Plan:**

1. Refactor `database.ts` to separate the initial schema (v1) from incremental migrations.
2. Add a `migrations` array where each entry is `{ version: number, up: string }`.
3. On startup, read the current version from `schema_version` and apply all migrations with `version > current` in order.
4. Wrap the entire migration sequence in a transaction.

```typescript
const MIGRATIONS = [
  {
    version: 2,
    up: `
      ALTER TABLE teams ADD COLUMN template_name TEXT;
      ALTER TABLE teams ADD COLUMN template_path TEXT;
      ALTER TABLE members ADD COLUMN role TEXT;
      -- communication tables (already use IF NOT EXISTS, safe to re-run)
      CREATE TABLE IF NOT EXISTS channels (...);
      CREATE TABLE IF NOT EXISTS channel_signals (...);
      ...
    `
  },
  // Future migrations go here
];
```

**Files to change:** `src/db/database.ts`
**Test additions:** `src/db/database.test.ts` -- test migration from v1 to v2, test idempotency, test that v2 databases aren't re-migrated.
**Scope:** Small-medium. The migration logic itself is straightforward; the main work is defining the v1 baseline and the v1->v2 diff accurately.

---

### Gap 2: Communication Enforcement is Declared but Never Applied

**Problem:**
`CommunicationConfig.enforcement` accepts `"strict" | "permissive" | "audit"` but the value is never stored in the database and never checked. `CommunicationService.emit()` writes events unconditionally. `canEmit()` exists but is never called.

**What currently happens:**
```yaml
communication:
  enforcement: strict    # ← has no effect
  emissions:
    planner: [TASK_CREATED]
```
```
openteams template emit myteam -c task_updates -s TASK_CREATED --sender grinder
→ succeeds, even though grinder has no emission permission
```

**Plan:**

1. **Store enforcement mode:** Add `enforcement TEXT DEFAULT 'permissive'` column to the `teams` table (or a new `team_config` table). Populate it during `applyConfig()`.
2. **Enforce in `emit()`:** Before inserting into `signal_events`, call `canEmit()`. Based on enforcement mode:
   - `strict`: throw an error if not permitted
   - `audit`: log a warning to `signal_events` with a special flag (or a separate audit table) but allow the emit
   - `permissive`: allow unconditionally (current behavior)
3. **Enforce in CLI:** The `template emit` command should surface the enforcement check result in its output.
4. **Return enforcement result:** `emit()` could return `{ event, permitted, enforcement }` so callers know what happened.

**Files to change:**
- `src/db/database.ts` -- add enforcement column or config table (new migration)
- `src/services/communication-service.ts` -- update `applyConfig()` to store enforcement, update `emit()` to check permissions
- `src/cli/template.ts` -- surface enforcement feedback in emit output

**Test additions:** Tests for each enforcement mode: strict rejects, audit allows with warning, permissive allows.
**Scope:** Medium. Requires a schema change (new migration), service logic, and CLI output changes.

---

### Gap 3: Role Inheritance (`extends`) is Unimplemented

**Problem:**
Roles can declare `extends: parent-role` and use `CapabilityComposition` (`add`/`remove` lists), but the loader never resolves the inheritance chain. A child role gets only its own `add` list, not the parent's capabilities minus `remove`.

**What currently happens:**
```yaml
# roles/senior-dev.yaml
name: senior-dev
capabilities: [code, review, deploy]

# roles/junior-dev.yaml
name: junior-dev
extends: senior-dev
capabilities:
  add: [code]
  remove: [deploy]
```
Result: `junior-dev` gets capabilities `[code]` only. The parent's `[code, review, deploy]` is ignored, and `remove: [deploy]` is never applied.

**Plan:**

1. After loading all role definitions in `TemplateLoader.load()`, run a **resolution pass**:
   - Build a map of `roleName -> ResolvedRole`
   - For each role with `extends`, look up the parent
   - Merge capabilities: start with parent's list, apply child's `add` (union), apply child's `remove` (difference)
   - Detect and error on circular inheritance chains
2. Handle multi-level inheritance (A extends B extends C) by resolving in topological order.

**Files to change:** `src/template/loader.ts` -- add `resolveInheritance()` private method called after the initial role loading loop.
**Test additions:** `src/template/loader.test.ts` -- test single-level inheritance, multi-level, add/remove composition, circular detection, extends referencing nonexistent role.
**Scope:** Small-medium. The algorithm is straightforward (topological sort + set operations).

---

## Significant Gaps

### Gap 4: ACPFactorySpawner Ignores `agentType`

**Problem:**
`ACPFactorySpawner.spawn()` uses `options.model ?? "claude-code"` as the provider but discards `options.agentType` entirely. The `--type bash|general-purpose|explore|plan` CLI flag is cosmetic.

**Plan:**

1. Investigate how `acp-factory` handles agent types / session configurations. If the ACP protocol supports passing agent type as a session parameter, wire it through.
2. If ACP doesn't natively support agent types, consider:
   - Injecting the agent type into the system prompt (e.g., prepending "You are a bash specialist agent")
   - Passing it as an environment variable to the spawned agent
   - Documenting that `--type` is metadata-only when using ACP
3. At minimum, pass `agentType` into the session creation or prompt so the spawned agent is aware of its intended role.

**Files to change:** `src/spawner/acp-factory.ts`
**Scope:** Small -- depends on ACP protocol capabilities. Worst case is documentation-only.

---

### Gap 5: No Team Existence Validation in TaskService and MessageService

**Problem:**
Creating tasks or sending messages against a nonexistent team produces raw SQLite foreign key errors instead of friendly messages.

**Plan:**

1. Add a private helper or shared utility: `assertTeamExists(db, teamName)` that checks for an active team and throws `Team "${name}" not found`.
2. Call it at the top of `TaskService.create()`, `MessageService.send()`, `broadcast()`, `sendShutdownRequest()`, etc.
3. Alternatively, inject `TeamService` into these services (like `AgentService` already does) and call `teamService.get()`.

**Files to change:**
- `src/services/task-service.ts`
- `src/services/message-service.ts`

**Test additions:** Tests that creating tasks/messages for nonexistent teams throws descriptive errors.
**Scope:** Small. A few lines per method.

---

### Gap 6: `listForAgent` Returns Duplicate Broadcasts

**Problem:**
The SQL condition `OR type = 'broadcast'` pulls all broadcast messages for the entire team, not just those addressed to the queried agent. Since broadcasts are stored as individual rows per recipient, this produces duplicates.

**Plan:**

Remove the `OR type = 'broadcast'` clause. Broadcasts addressed to agent X already have `recipient = X`, so the `recipient = ?` condition catches them correctly:

```sql
-- Before
WHERE team_name = ? AND (recipient = ? OR sender = ? OR type = 'broadcast')

-- After
WHERE team_name = ? AND (recipient = ? OR sender = ?)
```

**Files to change:** `src/services/message-service.ts:128`
**Test additions:** Add a test that verifies agent A doesn't see broadcasts addressed to agent B.
**Scope:** Tiny. One line change + test.

---

### Gap 7: Missing CLI Commands for Message Response Types

**Problem:**
`sendShutdownResponse()` and `sendPlanApprovalResponse()` exist in the service but have no CLI commands.

**Plan:**

Add two new subcommands under `openteams message`:

```
openteams message shutdown-response <team> --request-id <id> --approve|--reject [--content <text>] [--from <sender>]
openteams message plan-response <team> --to <recipient> --request-id <id> --approve|--reject [--content <text>] [--from <sender>]
```

**Files to change:** `src/cli/message.ts`
**Scope:** Small. Two new command registrations following the existing pattern.

---

### Gap 8: Undelivered Message System Not Surfaced

**Problem:**
`getUndelivered()` and `markDelivered()` exist in the service but the CLI has no way to poll for new messages or acknowledge delivery.

**Plan:**

Add two new CLI commands:

```
openteams message poll <team> --agent <name>
  → Lists undelivered messages for the agent
  → Optionally: --mark-delivered to auto-ack after display

openteams message ack <team> <message-id>
  → Marks a specific message as delivered
```

Also consider adding a `[delivered]`/`[undelivered]` indicator to `message list` output.

**Files to change:** `src/cli/message.ts`
**Scope:** Small. Two new commands + minor enhancement to list display.

---

### Gap 9: No JSON Output Mode

**Problem:**
All CLI output is human-readable text. Agents consuming openteams output must parse free-form strings.

**Plan:**

1. Add a global `--json` flag on the root `program` command.
2. Create a shared output helper, e.g. `output(data: unknown, humanReadable: string)` that checks the flag and either `console.log(JSON.stringify(data))` or `console.log(humanReadable)`.
3. Refactor each command to build a structured data object and pass both forms to the helper.

**Alternative (simpler first step):** Add `--json` to individual commands where agent consumption is most likely: `task list`, `task get`, `message list`, `message poll`, `agent list`, `agent info`, `template info`.

**Files to change:**
- `src/cli.ts` -- add global option
- `src/cli/*.ts` -- refactor each command's output path

**Scope:** Medium-large if done for all commands. Small if scoped to the most agent-facing commands first.

---

### Gap 10: No CLI Command to Add Members Without Spawning

**Problem:**
The only way to add a team member via CLI is `agent spawn`, which requires the spawner. External agents or human operators can't be registered.

**Plan:**

Add a new command:
```
openteams team add-member <team> <name> [--role <role>] [--type <type>] [--model <model>]
```

This calls `TeamService.addMember()` directly without invoking the spawner.

**Files to change:** `src/cli/team.ts`
**Scope:** Tiny. One new subcommand.

---

## Minor Gaps

### Gap 11: Task Dependency Cycle Detection

**Problem:**
Circular task dependencies can be created without warning, permanently blocking tasks.

**Plan:**

Add a `hasCycle(taskId, newDepId)` check in `TaskService.update()` before inserting edges. Use BFS/DFS from `newDepId` following `blocked_by` edges to see if it reaches `taskId`.

**Files to change:** `src/services/task-service.ts`
**Scope:** Small. ~15-20 lines of graph traversal.

---

### Gap 12: No Sender Membership Validation

**Problem:**
Message senders/recipients aren't validated against team membership. Any string works.

**Plan:**

Add optional validation in `MessageService.send()` and related methods. Check that sender and recipient exist in `members` for the team. Make this opt-in or controlled by a flag to preserve flexibility for system-generated messages.

**Files to change:** `src/services/message-service.ts`
**Scope:** Small. A few queries per method.

---

### Gap 13: Signal Event Payloads Not Parsed Consistently

**Problem:**
`SignalEvent.payload` is `string` (raw JSON) while `Task.metadata` is `Record<string, unknown>` (parsed). Inconsistent handling.

**Plan:**

Two options:
- **Option A:** Parse payload in the service layer (like task metadata). Change `SignalEvent.payload` type to `Record<string, unknown>`. Add a `rowToEvent()` converter.
- **Option B:** Keep as string, add `SignalEventRow` type alias, document that consumers should parse it.

Recommend **Option A** for consistency with the task metadata pattern.

**Files to change:** `src/template/types.ts`, `src/services/communication-service.ts`
**Scope:** Small.

---

### Gap 14: `ACPFactorySpawner` Exported Unconditionally

**Problem:**
`src/index.ts` exports `ACPFactorySpawner` but `acp-factory` is optional. Importing it without the dependency causes a runtime crash.

**Plan:**

Replace the direct export with a factory function:
```typescript
export function createACPFactorySpawner(): AgentSpawner {
  const { ACPFactorySpawner } = require("./spawner/acp-factory");
  return new ACPFactorySpawner();
}
```

Or add a clear `@throws` JSDoc annotation and keep the direct export with documentation.

**Files to change:** `src/index.ts`
**Scope:** Tiny.

---

### Gap 15: `design.md` is Out of Date

**Problem:**
The design doc reflects an earlier version of the project, missing communication tables, template service, generators, and several CLI command groups.

**Plan:**

Update `design.md` to reflect current state:
- Add template/communication tables to the schema section
- Add TemplateService, CommunicationService to architecture diagram
- Add generators section
- Add template and generate CLI commands
- Update file structure

**Scope:** Medium (documentation effort). Could also be addressed by marking it as historical and pointing to `SKILL.md`.

---

### Gap 16: Missing `engines` Field in `package.json`

**Problem:**
No Node.js version constraint despite using `crypto.randomUUID()` and ES2022 features.

**Plan:**

Add to `package.json`:
```json
"engines": {
  "node": ">=18.0.0"
}
```

Note: `crypto.randomUUID()` is available since Node 19.0, but Node 18.x has it behind `--experimental-global-webcrypto`. Since it's imported from `"crypto"` module (not global), it's available in Node 16+. Verify the minimum version and set accordingly.

**Files to change:** `package.json`
**Scope:** Tiny.

---

### Gap 17: Template Bootstrap Doesn't Populate Team Members

**Problem:**
`TemplateService.bootstrap()` creates the team and communication topology but doesn't register any members. The root and companion roles from the topology exist only as metadata.

**Plan:**

During bootstrap, auto-register the root and companion roles as members with status `"idle"`:
```typescript
// After creating team, register topology nodes as members
teamService.addMember(teamName, manifest.topology.root.role, {
  role: manifest.topology.root.role,
  agentType: 'general-purpose',
});
for (const comp of manifest.topology.companions ?? []) {
  teamService.addMember(teamName, comp.role, {
    role: comp.role,
    agentType: 'general-purpose',
  });
}
```

**Consideration:** This changes bootstrap semantics. Should be opt-in or documented as a behavior change. Some users may prefer to register members manually.

**Files to change:** `src/services/template-service.ts`
**Scope:** Small.

---

### Gap 18: Global Spawner Interface Disconnected From CLI

**Problem:**
`setSpawner()`/`getSpawner()` in `src/spawner/interface.ts` is exported but never used by the CLI. The CLI creates its own spawner instance.

**Plan:**

Two options:
- **Option A:** Wire CLI to use the global: call `setSpawner()` in `cli.ts`, have `createAgentCommands()` use `getSpawner()` instead of receiving a parameter.
- **Option B:** Remove the global interface. Let consumers manage spawner instances via dependency injection (pass to service constructors).

Recommend **Option B** -- dependency injection is cleaner and more testable. The global singleton adds complexity without benefit.

If keeping the global for backward compatibility, at minimum have `cli.ts` call `setSpawner(spawner)` so the global and CLI stay in sync.

**Files to change:** `src/spawner/interface.ts`, `src/cli.ts`, `src/index.ts`
**Scope:** Small.

---

## Suggested Priority Order

| Priority | Gap | Effort | Impact |
|----------|-----|--------|--------|
| P0 | Gap 1: Schema migrations | Medium | Prevents data loss on upgrades |
| P0 | Gap 6: Broadcast query bug | Tiny | Correctness fix |
| P1 | Gap 2: Enforcement mode | Medium | Core feature is non-functional |
| P1 | Gap 5: Team validation | Small | Better error messages |
| P1 | Gap 9: JSON output | Medium | Unblocks agent-as-consumer use case |
| P1 | Gap 8: Undelivered messages CLI | Small | Key coordination primitive |
| P2 | Gap 3: Role inheritance | Small-Med | Template feature completeness |
| P2 | Gap 7: Response CLI commands | Small | Workflow completeness |
| P2 | Gap 10: Add member CLI | Tiny | Flexibility for external agents |
| P2 | Gap 11: Cycle detection | Small | Data integrity |
| P2 | Gap 4: Agent type in spawner | Small | Spawn accuracy |
| P3 | Gap 13: Payload parsing | Small | Consistency |
| P3 | Gap 14: Conditional export | Tiny | Library safety |
| P3 | Gap 16: Engines field | Tiny | Package metadata |
| P3 | Gap 12: Sender validation | Small | Data integrity |
| P3 | Gap 17: Bootstrap members | Small | Convenience |
| P3 | Gap 18: Spawner interface | Small | API cleanliness |
| P3 | Gap 15: design.md update | Medium | Documentation |
