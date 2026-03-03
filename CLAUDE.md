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
  cli/                   # CLI command definitions (template, generate, editor).
  template/
    loader.ts            # TemplateLoader.load() / loadAsync() — static methods. YAML parsing,
                         #   role inheritance resolution, prompt loading, MCP server config.
    types.ts             # All types: TeamManifest, ResolvedTemplate, ResolvedRole,
                         #   CommunicationConfig, LoadOptions, AsyncLoadOptions.
    install-service.ts   # TemplateInstallService — git clone, discover, install templates.
  generators/
    skill-generator.ts   # generateSkillMd(), generateCatalog() from templates.
    agent-prompt-generator.ts  # generateAgentPrompts(), generateRoleSkillMd().
    package-generator.ts # generatePackage() — bundle template for distribution.
examples/
  gsd/                   # 12-role team template with wave-based execution.
  bmad-method/           # Alternative team topology example.
schema/
  team.schema.json       # JSON Schema for team.yaml validation.
  role.schema.json       # JSON Schema for role YAML validation.
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
- `openteams editor` — launch visual team configuration editor

## Conventions

- TypeScript strict mode. Target ES2022, CommonJS output.
- All types in `src/template/types.ts`.
- CLI is a thin layer. No business logic in CLI files.
- Role inheritance cycle detection uses chain-following in `TemplateLoader.resolveInheritance()`.
