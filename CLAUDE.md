# OpenTeams

TypeScript CLI and library for defining multi-agent team structures. YAML team templates, role inheritance, loadouts, communication topology, federation across teams, and prompt generation.

OpenTeams is a **definition layer** — it defines team structures that agent systems (Claude Code, Gemini, Codex, etc.) consume and map to their own runtime primitives. It does not manage runtime state, spawn agents, or track tasks. The `runtime/` module offers optional helpers for observing state a consumer already manages; it doesn't run anything itself.

## Quick Reference

```bash
npm install               # install dependencies (npm workspaces: root + editor/)
npm run build              # compile TypeScript (cjs + esm) and build the editor
npm test                   # run vitest (src/**/*.test.ts)
npm run test:watch         # watch mode
npm run test:editor        # run editor package's tests
npm run test:all           # root tests + editor tests
npm run dev                # tsc --watch
```

## Architecture

```
src/
  cli.ts                  # Entry point. Commander program with 5 subcommand groups.
  index.ts                # Public API exports (types, loader, generators, sync, runtime).
  cli/                    # CLI command definitions: template, generate, loadout, bundle, editor.
  template/
    loader.ts             # TemplateLoader.load() / loadAsync() — static methods. YAML parsing,
                           #   role + loadout inheritance resolution (with cycle detection), prompts.
    loadout-merge.ts       # Canonical loadout merge rules (mergeLoadout, resolveStandaloneLoadout).
    federation-loader.ts   # loadFederation() / composeFederation() — multi-team federation manifests.
    resolver.ts            # Unified template resolution: built-in vs installed vs path, config I/O.
    builtins.ts            # Built-in template registry (ships example templates as named templates).
    install-service.ts     # TemplateInstallService — git clone, discover, install templates.
    types.ts               # All template/loadout/federation types.
  runtime/
    team-state.ts          # TeamState — event-driven state machine, snapshots, listeners.
    member-registry.ts     # MemberRegistry — bidirectional role/label/agentId resolution.
    validation.ts          # validateMessage() / validateBridgeMessage() — topology checks.
    federation-state.ts    # FederationState — cross-team state observation.
    types.ts               # Runtime types (MemberIdentity, TeamEvent, ValidationResult, ...).
  generators/
    skill-generator.ts     # generateSkillMd(), generateCatalog() from templates.
    agent-prompt-generator.ts  # generateAgentPrompts(), generateRoleSkillMd().
    package-generator.ts   # generatePackage() — bundle a template for distribution.
    loadout-generator.ts   # generateLoadoutArtifacts(), getEffectiveLoadout(), renderLoadoutYaml().
    federation-generator.ts  # generateFederatedSkillMd(), generateBridgeContext().
  sync/                    # MAP Resource Protocol bundling/publishing (content-addressed).
    bundle.ts              # canonicalize/hash, bundleLoadout/bundleTeam, hydrate, verify.
    uri.ts                 # parseRef/formatRef for x-openteams/* resource refs.
    client.ts              # createOpenTeamsClient() — thin wrapper interface over a MAP SDK client.
    handlers.ts            # Resource kind handlers (loadout/team) for a MAP-compatible server.
    store.ts               # InMemoryBundleStore reference implementation.
    spawn.ts               # encodeSpawnTaskMeta/decodeSpawnTaskMeta for spawn-over-MAP.
    validate.ts            # validateLoadoutBundle / validateTeamBundle.
examples/                  # 10 example templates (gsd, bmad-method, loadout-demo, security-audit,
                           #   incident-response, bug-fix-pipeline, codebase-migration, docs-sync,
                           #   pr-review-checks, sync-walkthrough).
schema/
  team.schema.json         # JSON Schema for team.yaml validation.
  role.schema.json         # JSON Schema for role YAML validation.
  loadout.schema.json      # JSON Schema for loadouts/<name>.yaml validation.
editor/                    # Separate npm workspace: browser-based visual team config editor (Vite).
docs/                      # Design docs: federated-teams-design.md, map-integration.md,
                           #   team-map-sync-design.md, visual-editor-design.md.
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

**Loadouts**: Reusable bundles of skills, capabilities, MCP servers, permissions, and prompt material. Authored in `loadouts/<name>.yaml`, bound to roles via `role.loadout` (slug reference or inline definition). Resolved through the same topological inheritance algorithm as roles, with per-field merge rules in `loadout-merge.ts` (union for capabilities/MCP/permissions.allow; deny-wins for permissions.deny; replace-if-set for skills.profile and skills.max_tokens; concatenate for prompt_addendum).

For consumers that need to override or inject loadouts from outside the template directory (e.g. per-tenant DB overrides), `LoadOptions.resolveExternalLoadout` and `LoadOptions.postProcessLoadout` hooks are available. `mergeLoadout` + `resolveStandaloneLoadout` are exported from the package index for consumers implementing their own layering logic.

**MCP server refs**: Loadouts accept `{ ref: "@org/server-name" }` entries for symbolic references to MCP servers. OpenTeams stores refs verbatim — it does not ship a registry. Consuming systems are responsible for resolving refs at materialization time.

**MCP install vs scope**: Install and scope are separate concerns.
- `team.yaml:mcp_providers` declares *install specs* — advisory, consumer decides whether to install. Field shape matches the Claude Code / Cursor / Windsurf `mcpServers` format (with `ref`, `disabled`, `description` as openteams extensions).
- `loadouts/*.yaml:mcp_servers` declares *scope* — which servers from the base set a role may call, optionally narrowed by `tools` allowlist or `exclude` denylist. Four accepted shapes: bare string (full scope), single-key map with array value (tool allowlist), single-key map with `{ tools?, exclude? }` (options), and the existing install/ref shapes (install + scope).
- Omitting `mcp_servers` entirely = permissive (full base-set access). Declaring it restricts to the listed servers.
- Consumers call `generateLoadoutArtifacts(loadout)` to get normalized `mcpScope: NormalizedMcpScope[]` and `findMissingMcpReferences(template, installedSet?)` to warn about scope references absent from the base set.

**Federation**: Multiple team templates can be composed into one federation via a federation manifest, loaded with `loadFederation()` / `composeFederation()`. `FederationState` observes cross-team status. `generateFederatedSkillMd()` / `generateBridgeContext()` produce cross-team-aware artifacts. See `docs/federated-teams-design.md`.

**Sync (MAP Resource Protocol)**: `src/sync/` implements content-addressed bundling so a loadout or team can be published to a [Multi-Agent Protocol](https://github.com/alexngai/multi-agent-protocol) (MAP) hub and fetched by id. `bundleLoadout`/`bundleTeam` produce a deterministic JSON envelope keyed by a content hash (`canonicalize` + `hash`); same input always produces the same hash. `createOpenTeamsClient()` wraps a MAP SDK client's `getLoadout`/`getTeam`/publish calls. See `docs/map-integration.md` and `docs/team-map-sync-design.md`.

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

**Built-in templates**: `src/template/builtins.ts` registers a subset of `examples/` as named built-in templates resolvable without a path (see `resolveTemplateName` / `listAllTemplates` in `template/resolver.ts`).

## Testing

Tests are colocated: `src/template/loader.test.ts` next to `src/template/loader.ts`. No database required. The `editor/` workspace has its own separate test suite (`npm run test:editor`).

```bash
npm test                                              # run all tests (src/**/*.test.ts, vitest, globals on, watch off)
npx vitest run src/generators/skill-generator.test.ts # single file
```

## CLI Subcommands

- `openteams template` — validate, list, init, install (from git repos)
- `openteams generate` — skill, agents, all, package, catalog, role-package (from templates)
- `openteams loadout` — validate, list, show, preview (inspect template loadouts)
- `openteams bundle` — team, loadout, verify (content-addressed MAP resource bundles)
- `openteams editor` — launch the visual team configuration editor

## Conventions

- TypeScript strict mode. Target ES2022. Dual build: CommonJS (`dist/cjs`) + ESM (`dist/esm`), driven by separate `tsconfig.cjs.json` / `tsconfig.esm.json`.
- Template types in `src/template/types.ts`. Runtime types in `src/runtime/types.ts`. Sync/bundle types in `src/sync/types.ts`.
- CLI is a thin layer over `cli/*.ts` command modules. No business logic in CLI files.
- Role inheritance cycle detection happens in `TemplateLoader`'s internal `resolveInheritance`/`resolveInheritanceCore` (chain-following through local roles, throws on cycle).
- The `editor/` directory is a separate npm workspace (its own `package.json`, Vite-based) — build it via `npm run build:editor` from the root, or `cd editor && npm run build`.
