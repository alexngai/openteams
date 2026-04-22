# OpenTeams

TypeScript CLI and library for defining multi-agent team structures. YAML team templates, role inheritance, communication topology, prompt generation.

OpenTeams is a **definition layer** — it defines team structures that agent systems (Claude Code, Gemini, Codex, etc.) consume and map to their own runtime primitives. It does not manage runtime state, spawn agents, or track tasks.

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
  cli.ts                 # Entry point. Commander program with 3 subcommand groups.
  index.ts               # Public API exports (types, loader, generators, install service).
  cli/                   # CLI command definitions (template, generate, loadout, editor).
  template/
    loader.ts            # TemplateLoader.load() / loadAsync() — static methods. YAML parsing,
                         #   role + loadout inheritance resolution, prompt loading, MCP server config.
    loadout-merge.ts     # Canonical loadout merge rules (mergeLoadout, resolveStandaloneLoadout).
                         #   Exported from index so consumers can apply them in override layers.
    types.ts             # All types: TeamManifest, RoleDefinition, LoadoutDefinition,
                         #   ResolvedTemplate, ResolvedRole, ResolvedLoadout, SkillsConfig,
                         #   PermissionsConfig, McpServerRef, LoadOptions, AsyncLoadOptions.
    install-service.ts   # TemplateInstallService — git clone, discover, install templates.
  runtime/
    types.ts             # Runtime types: MemberIdentity, MemberStatus, TeamEvent,
                         #   StateChangeEvent, TeamStateSnapshot, ValidationResult.
    member-registry.ts   # MemberRegistry — bidirectional role/label/agentId resolution.
    validation.ts        # validateMessage() — stateless topology communication checks.
    team-state.ts        # TeamState — event-driven state machine, snapshots, listeners.
  generators/
    skill-generator.ts   # generateSkillMd(), generateCatalog() from templates.
    agent-prompt-generator.ts  # generateAgentPrompts(), generateRoleSkillMd().
                         #   Appends role.loadout.promptAddendum when present.
    package-generator.ts # generatePackage() — bundle template for distribution.
    loadout-generator.ts # generateLoadoutArtifacts(), getEffectiveLoadout(),
                         #   renderLoadoutYaml(), listLoadoutConsumers().
examples/
  gsd/                   # 12-role team template with wave-based execution.
  bmad-method/           # Alternative team topology example.
  loadout-demo/          # Three-role team exercising loadout binding styles.
schema/
  team.schema.json       # JSON Schema for team.yaml validation.
  role.schema.json       # JSON Schema for role YAML validation.
  loadout.schema.json    # JSON Schema for loadouts/<name>.yaml validation.
```

## Key Patterns

**Template loading**: `TemplateLoader` methods are static. `load()` is synchronous, `loadAsync()` supports async hooks.

```typescript
const template = TemplateLoader.load("./examples/gsd");
const template = await TemplateLoader.loadAsync(dir, {
  resolveExternalRole: (name) => /* resolve roles not in local map */,
  postProcessRole: (role, manifest) => /* enrich after inheritance */,
});
```

**Generators**: All generators take a `ResolvedTemplate` and produce artifacts (markdown, file trees).

```typescript
const template = TemplateLoader.load("./my-team");
const skillMd = generateSkillMd(template, { teamName: "my-team" });
const prompts = generateAgentPrompts(template, { teamName: "my-team" });
const pkg = generatePackage(template, { teamName: "my-team", outputDir: "./out" });
```

**Template install**: Clone templates from git repos into local `.openteams/templates/` directories.

```typescript
const installer = new TemplateInstallService();
const result = await installer.install({ repoUrl: "owner/repo" }, callbacks);
```

**Loadouts**: Reusable bundles of skills, capabilities, MCP servers, permissions, and prompt material. Authored in `loadouts/<name>.yaml`, bound to roles via `role.loadout` (slug reference or inline definition). Resolve through the same topological inheritance algorithm as roles, with per-field merge rules in `loadout-merge.ts` (union for capabilities/MCP/permissions.allow; deny-wins for permissions.deny; replace-if-set for skills.profile and skills.max_tokens; concatenate for prompt_addendum).

```typescript
const template = TemplateLoader.load("./examples/loadout-demo");
const reviewer = template.roles.get("reviewer")!;
console.log(reviewer.loadout?.capabilities);   // merged across extends chain
console.log(reviewer.loadout?.mcpServers);     // inline entries + symbolic refs
console.log(reviewer.loadout?.permissions);    // deny list accumulated
```

For consumers that need to override or inject loadouts from outside the template directory (e.g. per-tenant DB overrides in OpenHive), `LoadOptions.resolveExternalLoadout` and `LoadOptions.postProcessLoadout` hooks are available. The `mergeLoadout` + `resolveStandaloneLoadout` helpers are exported from the package index for consumers implementing their own layering logic.

**MCP server refs**: Loadouts accept `{ ref: "@org/server-name" }` entries for symbolic references to MCP servers. OpenTeams stores refs verbatim — it does not ship a registry. Consuming systems (OpenHive against its DB, claude-code-swarm against a bundled list) are responsible for resolving refs at materialization time.

**Runtime state observation**: `TeamState` tracks member identity, status, and communication validity at runtime. Accepts MAP-aligned events, validates against template topology.

```typescript
const template = TemplateLoader.load("./examples/gsd");
const team = new TeamState("gsd", template);
team.applyEvent({ type: "agent_registered", role: "architect", label: "architect", agentId: "gsd-architect" });
team.applyEvent({ type: "agent_state_changed", agentId: "gsd-architect", status: "idle" });
team.onStateChange((e) => console.log(e.member.identity.label, e.member.status));
const snap = team.snapshot(); // serializable
```

**Communication topology**: Defined in `team.yaml` under `communication:`. Describes channels, signals, subscriptions, emissions, and routing. Agent systems read this and implement enforcement.

**Enforcement modes**: `permissive`, `audit`, `strict` — defined as configuration in the template. Interpretation and enforcement is left to the consuming agent system.

**Extension namespaces**: `team.yaml` supports arbitrary top-level keys (e.g., `macro_agent:`, `gsd:`). OpenTeams stores but does not interpret them.

## Testing

Tests are colocated: `src/template/loader.test.ts` next to `src/template/loader.ts`. No database required.

```bash
npm test                                              # run all tests
npx vitest run src/generators/skill-generator.test.ts  # single file
```

Vitest config: `vitest.config.ts`. Globals enabled, watch off by default.

## CLI Subcommands

- `openteams template` — validate, install (from git repos)
- `openteams generate` — skill, catalog, agents, all, package, role-package (from templates)
- `openteams loadout` — validate, list, show, preview (inspect template loadouts)
- `openteams editor` — launch visual team configuration editor

## Conventions

- TypeScript strict mode. Target ES2022, CommonJS output.
- Template types in `src/template/types.ts`. Runtime types in `src/runtime/types.ts`.
- CLI is a thin layer. No business logic in CLI files.
- Role inheritance cycle detection uses chain-following in `TemplateLoader.resolveInheritance()`.
