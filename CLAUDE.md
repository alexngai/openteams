# OpenTeams

TypeScript CLI and library for multi-agent team coordination. SQLite-backed state, YAML team templates, typed signal channels.

## Quick Reference

```bash
npm install              # install dependencies
npm run build            # compile TypeScript to dist/
npm test                 # run vitest (all tests in src/**/*.test.ts)
npm run test:watch       # watch mode
npm run dev              # tsc --watch
```

## Architecture

```
src/
  cli.ts                 # Entry point. Commander program with 6 subcommand groups.
  index.ts               # Public API exports (types, services, generators, spawner).
  types.ts               # Core types: Team, Member, Task, Message, AgentSpawner.
  cli/                   # CLI command definitions (team, task, message, agent, template, generate).
  db/database.ts         # SQLite schema, migration framework, createDatabase/createInMemoryDatabase.
  services/              # Business logic layer. Each service takes a Database instance.
    team-service.ts      # Team CRUD, enforcement mode.
    task-service.ts      # Task CRUD, dependency tracking (task_deps), cycle detection.
    message-service.ts   # send, broadcast, getUndelivered, markDelivered, shutdown protocol.
    agent-service.ts     # spawn (via AgentSpawner interface), shutdown, member lifecycle.
    template-service.ts  # TemplateService(db) — bootstrap teams from resolved templates.
    communication-service.ts  # Channels, subscriptions, emissions, enforcement, signal events.
  template/
    loader.ts            # TemplateLoader.load() / loadAsync() — static methods. YAML parsing,
                         #   role inheritance resolution, prompt loading, MCP server config.
    types.ts             # Template types: TeamManifest, ResolvedTemplate, ResolvedRole,
                         #   CommunicationConfig, LoadOptions, AsyncLoadOptions.
  generators/
    skill-generator.ts   # generateSkillMd(), generateCatalog() from templates.
    agent-prompt-generator.ts  # generateAgentPrompts(), generateRoleSkillMd().
    package-generator.ts # generatePackage() — bundle template for distribution.
  spawner/
    interface.ts         # setSpawner/getSpawner/hasSpawner — global spawner registry.
    acp-factory.ts       # ACPFactorySpawner (optional dep on acp-factory package).
    mock.ts              # MockSpawner for testing.
examples/
  get-shit-done/         # 12-role team template with wave-based execution.
  bmad-method/           # Alternative team topology example.
schema/
  team.schema.json       # JSON Schema for team.yaml validation.
  role.schema.json       # JSON Schema for role YAML validation.
```

## Key Patterns

**Service initialization**: Services take a `Database` (better-sqlite3) instance. `TemplateService` creates its own internal `TeamService` and `CommunicationService`. Do not pass them in.

```typescript
const db = createDatabase();        // file-backed (~/.openteams/openteams.db)
const db = createInMemoryDatabase(); // for tests
const teamService = new TeamService(db);
const templateService = new TemplateService(db); // creates sub-services internally
```

**Template loading**: `TemplateLoader` methods are static. `load()` is synchronous, `loadAsync()` supports async hooks.

```typescript
const template = TemplateLoader.load("./examples/get-shit-done");
const template = await TemplateLoader.loadAsync(dir, {
  resolveExternalRole: (name) => /* resolve roles not in local map */,
  postProcessRole: (role, manifest) => /* enrich after inheritance */,
});
```

**Agent spawner**: Pluggable via `AgentSpawner` interface. CLI falls back to `MockSpawner` if `acp-factory` is not installed.

**Enforcement modes**: `permissive` (log and allow), `audit` (record `permitted: false` in signal_events), `strict` (reject emission). Set per-team on the communication config.

**Extension namespaces**: `team.yaml` supports arbitrary top-level keys (e.g., `macro_agent:`, `gsd:`). OpenTeams stores but does not interpret them.

## Database

SQLite via `better-sqlite3`. WAL mode, foreign keys enabled.

Schema version tracked in `schema_version` table. Migration framework in `src/db/database.ts`:
1. Update `SCHEMA_SQL` for fresh installs
2. Add a `Migration` entry with the next version number
3. Bump `CURRENT_VERSION`

Tables: `teams`, `members`, `tasks`, `task_deps`, `messages`, `channels`, `channel_signals`, `subscriptions`, `emissions`, `peer_routes`, `signal_events`, `spawn_rules`.

## Testing

Tests are colocated: `src/services/team-service.test.ts` next to `src/services/team-service.ts`. All tests use `createInMemoryDatabase()` for isolation.

```bash
npm test                          # run all tests
npx vitest run src/services/task-service.test.ts  # single file
```

Vitest config: `vitest.config.ts`. Globals enabled, watch off by default.

## CLI Subcommands

- `openteams team` — create, list, show, delete, set-enforcement
- `openteams task` — create, list, show, update (status, owner, blocked-by)
- `openteams message` — send, broadcast, list, poll, shutdown-request, shutdown-response
- `openteams agent` — spawn, list, shutdown
- `openteams template` — bootstrap (load team.yaml and provision team + communication)
- `openteams generate` — skill, catalog, prompts, package (from templates)

## Conventions

- TypeScript strict mode. Target ES2022, CommonJS output.
- Types in `src/types.ts` (runtime types) and `src/template/types.ts` (template types).
- CLI is a thin layer over services. No business logic in CLI files.
- Row types (e.g., `TaskRow`, `MessageRow`) have SQLite-native fields (strings for JSON, integers for booleans). Service types have parsed fields.
- Dependency cycle detection uses chain-following in `TaskService.addDependency()` and `TemplateLoader.resolveInheritance()`.
