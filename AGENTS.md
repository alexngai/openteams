# Agent Instructions

OpenTeams is a TypeScript CLI and library that defines multi-agent team structures — YAML team templates with role inheritance, reusable loadouts (skills/capabilities/MCP scope/permissions), communication topology, and federation across teams. It's a **definition layer**: it does not manage runtime state, spawn agents, or track tasks — consuming agent systems (Claude Code, Gemini, Codex, etc.) read the resolved template and implement their own runtime behavior.

## Build & test

```bash
npm install         # npm workspaces: root + editor/
npm run build       # compile TypeScript (cjs + esm), then build editor/
npm test            # vitest run (src/**/*.test.ts)
npm run test:all    # root tests + editor/ tests
```

## Key entry points

- `src/template/loader.ts` — `TemplateLoader.load()`/`loadAsync()`, static methods, resolves role/loadout inheritance and prompts.
- `src/generators/` — produce SKILL.md, agent prompts, packages, and loadout artifacts from a `ResolvedTemplate`.
- `src/sync/` — MAP Resource Protocol bundling (content-addressed hash, publish/fetch via a MAP hub).
- `src/runtime/` — optional helpers (`TeamState`, `MemberRegistry`) for observing runtime state a consumer already manages.
- `examples/` — 10 example team templates (`team.yaml` + `roles/` + optional `loadouts/`, `prompts/`).
- `schema/` — JSON Schemas for `team.yaml`, role YAML, and `loadouts/<name>.yaml`.

## Conventions

- TypeScript strict mode, dual CJS/ESM build.
- Tests are colocated next to source (`foo.ts` + `foo.test.ts`).
- CLI (`src/cli/*.ts`) is a thin layer — no business logic there.
- `editor/` is a separate npm workspace (own `package.json`, Vite) with its own test suite.

See `CLAUDE.md` for the full guide.
