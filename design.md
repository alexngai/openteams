# OpenTeams - Design Document

## Overview

OpenTeams is a TypeScript CLI and library for defining multi-agent team structures. It provides a YAML-based template system for declaring roles, topology, communication patterns, and prompts. It is a **definition layer** — it does not manage runtime state, spawn agents, or track tasks.

Agent systems (Claude Code, Gemini, Codex, etc.) consume the resolved template structure and map it to their own runtime primitives: task management, messaging, agent spawning, and enforcement.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      CLI Layer                            │
│  openteams template|generate|editor                      │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                 Template Layer                             │
│  TemplateLoader — YAML parsing, role inheritance,         │
│                   prompt loading, MCP server config        │
│  TemplateInstallService — git clone, discover, install    │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                  Generator Layer                           │
│  generateSkillMd · generateCatalog                        │
│  generateAgentPrompts · generateRoleSkillMd               │
│  generatePackage                                          │
└───────────────────────────────────────────────────────────┘
```

### Components

1. **CLI Layer** (`src/cli/`) — Command parsing via `commander`. Thin layer that delegates to the template layer and generators.
2. **Template Layer** (`src/template/`) — YAML parsing, role inheritance resolution, prompt loading, MCP server config, and template installation from git.
3. **Generator Layer** (`src/generators/`) — Generate SKILL.md files, agent prompts, role catalogs, and deployable package artifacts from resolved templates.

## Data Model

All data lives in YAML files. There is no database or runtime state.

### TeamManifest (team.yaml)

The root manifest declares the team structure:

```typescript
interface TeamManifest {
  name: string;
  description?: string;
  version: number;
  roles: string[];
  topology: TopologyConfig;
  communication?: CommunicationConfig;
  // Extension fields — stored but not interpreted
  [key: string]: unknown;
}
```

### TopologyConfig

Describes which roles exist, which is the root, which are companions, and spawn rules:

```typescript
interface TopologyConfig {
  root: TopologyNode;              // Primary agent
  companions?: TopologyNode[];     // Additional agents spawned alongside root
  spawn_rules?: Record<string, SpawnRuleEntry[]>; // Which roles can spawn which
}

interface TopologyNode {
  role: string;
  prompt?: string;                 // Path to prompt file
  config?: TopologyNodeConfig;     // Model, custom config
}

type SpawnRuleEntry = string | { role: string; max_instances?: number };
```

### CommunicationConfig

Structural metadata describing the communication contract. Agent systems read this and implement enforcement.

```typescript
interface CommunicationConfig {
  enforcement?: "strict" | "permissive" | "audit";
  channels?: Record<string, ChannelDefinition>;
  subscriptions?: Record<string, SubscriptionEntry[]>;
  emissions?: Record<string, string[]>;
  routing?: RoutingConfig;
}
```

### RoleDefinition (roles/<name>.yaml)

```typescript
interface RoleDefinition {
  name: string;
  extends?: string;                // Single inheritance
  display_name?: string;
  description?: string;
  capabilities?: string[] | CapabilityComposition | CapabilityMap;
  prompt?: string;                 // Single prompt file path
  prompts?: string[];              // Ordered list of prompt files
  loadout?: string | LoadoutDefinition;  // Slug reference or inline loadout
  // Extension fields
  [key: string]: unknown;
}
```

### LoadoutDefinition (loadouts/<name>.yaml)

A loadout is a reusable bundle of skills, capabilities, MCP servers, permissions, and prompt material. Loadouts support single inheritance with the same `extends` semantics as roles.

```typescript
interface LoadoutDefinition {
  name: string;
  extends?: string;                // Single inheritance
  description?: string;
  skills?: SkillsConfig;
  capabilities?: string[] | CapabilityComposition | CapabilityMap;
  capabilities_add?: string[];
  capabilities_remove?: string[];
  mcp_servers?: (McpServerEntry | McpServerRef)[];
  permissions?: PermissionsConfig;
  prompt_addendum?: string;
  // Extension fields
  [key: string]: unknown;
}

interface SkillsConfig {
  profile?: string;
  include?: string[];
  exclude?: string[];
  max_tokens?: number;
}

interface PermissionsConfig {
  allow?: string[];
  deny?: string[];   // Always wins across inheritance
  ask?: string[];
}

interface McpServerRef {
  ref: string;       // Resolved by consuming system; OpenTeams stores verbatim
  config?: Record<string, unknown>;
}
```

### ResolvedTemplate

The fully loaded and resolved template, output of `TemplateLoader.load()`:

```typescript
interface ResolvedTemplate {
  manifest: TeamManifest;
  roles: Map<string, ResolvedRole>;       // After inheritance resolution
  prompts: Map<string, ResolvedPrompts>;  // Role name → loaded prompts
  mcpServers: Map<string, McpServerEntry[]>;  // Legacy tools/mcp-servers.json path
  loadouts: Map<string, ResolvedLoadout>; // All resolved loadouts by name
  sourcePath: string;
}

interface ResolvedRole {
  // ... identity + capabilities ...
  loadout?: ResolvedLoadout;              // Attached if role declared one
}
```

## Template Loading

`TemplateLoader` provides static methods for loading templates:

```
TemplateLoader.load(dir)
  → Parse team.yaml (manifest validation)
  → Load role definitions from roles/*.yaml
  → Load loadout definitions from loadouts/*.yaml       (raw, pre-inheritance)
  → Resolve role inheritance chains (cycle detection)
  → Resolve loadout inheritance chains (cycle detection, same algorithm)
  → Apply capability composition (add/remove)
  → Attach resolved loadouts to roles (slug ref or inline)
  → Load prompts from prompts/<role>/*.md
  → Load MCP server config (legacy tools/mcp-servers.json)
  → Return ResolvedTemplate
```

### Extension Points

Both `load()` and `loadAsync()` accept hooks:

- **`resolveExternalRole`** — Resolve a role that `extends` a name not found in the local roles directory
- **`resolveExternalLoadout`** — Resolve a loadout (referenced by a role, or as a loadout's `extends` target) not found in the local `loadouts/` directory. Used by consumers like OpenHive to supply loadouts from a database at load time.
- **`postProcessRole`** — Enrich each role after inheritance resolution
- **`postProcessLoadout`** — Enrich each loadout after inheritance resolution (before attachment to roles)
- **`postProcess`** — Transform the entire template after loading

### Role Inheritance

Roles support single-inheritance via `extends`:

```yaml
# roles/senior.yaml
name: senior
capabilities: [code, review, deploy]

# roles/junior.yaml
name: junior
extends: senior
capabilities:
  add: [debug]
  remove: [deploy]
# Result: [code, review, debug]
```

Multi-level chains (A extends B extends C) are resolved in topological order. Circular inheritance is detected and rejected at template load time.

### Loadout Resolution

Loadouts use the same inheritance algorithm as roles (topological order, cycle detection), but with per-field merge rules encoded in `src/template/loadout-merge.ts`:

| Field | Strategy |
|---|---|
| `skills.profile`, `skills.max_tokens` | Replace-if-set |
| `skills.include`, `skills.exclude` | Union |
| `capabilities` | Same composition (`add`/`remove`) as roles |
| `mcp_servers` | Union by `name`/`ref`; child wins on conflict |
| `permissions.allow`, `.ask` | Union |
| `permissions.deny` | Union — **deny always wins** (child cannot drop parent denies) |
| `prompt_addendum` | Concatenated parent → child with blank-line separator |

Role → loadout attachment supports three shapes:

1. **No binding** — `role.loadout` is undefined; role runs with whatever capabilities its own YAML declares.
2. **Slug reference** — `role.loadout: "security-auditor"` looks up `loadouts/security-auditor.yaml`, falling back to `resolveExternalLoadout` if absent.
3. **Inline definition** — `role.loadout: { extends: security-auditor, capabilities_add: [...] }` resolves as a synthetic loadout named `__inline:<roleName>`.

The merge utility (`mergeLoadout`, `resolveStandaloneLoadout`) is exported from the package index so consumers implementing their own override layers (e.g. per-tenant DB overrides) can apply the canonical rules without reimplementing them.

## Communication Model

Three layers, all defined as structural metadata:

1. **Signal channels** — Topic-based pub/sub with per-role subscription filtering
2. **Peer routes** — Direct role-to-role routing (`direct`, `topic`, or `scope`)
3. **Enforcement modes** — `permissive`, `audit`, `strict` — guidelines for the consuming agent system

Signals are emitted through channels. Roles subscribe to channels with optional signal-level filtering. Emission permissions restrict which signals a role can emit.

## Generators

All generators take a `ResolvedTemplate` and produce artifacts:

| Generator | Output |
|-----------|--------|
| `generateSkillMd()` | SKILL.md content (team overview, roles, capabilities) |
| `generateCatalog()` | Lightweight role catalog |
| `generateAgentPrompts()` | Per-role prompt files |
| `generateRoleSkillMd()` | Standalone SKILL.md for a single role |
| `generatePackage()` | Deployable directory with all artifacts |

## Template Installation

`TemplateInstallService` handles installing templates from git repositories:

1. Shallow-clone the repo
2. Discover templates (directories containing `team.yaml`)
3. If multiple templates found, prompt for selection
4. Copy to `.openteams/templates/` (local or global)
5. Validate the installed template
6. Write provenance metadata

## CLI Commands

```
openteams template validate <dir>              # Validate template
openteams template install <repo-url> [name]   # Install from git

openteams generate skill <dir>                 # Generate SKILL.md
openteams generate catalog <dir>               # Generate role catalog
openteams generate agents <dir>                # Generate agent prompts
openteams generate all <dir>                   # Generate all artifacts
openteams generate package <dir>               # Generate deployable package
openteams generate role-package <dir> -r <role> # Generate single-role SKILL.md

openteams editor                               # Launch visual editor
```

## Testing Strategy

- **Template loader tests** with temporary filesystem fixtures and inline manifests
- **Generator tests** using `TemplateLoader.loadFromManifest()` for isolated test templates
- **Install service tests** for git operations and template discovery
- Framework: vitest
- No database or external services required

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing |
| `js-yaml` | YAML template parsing |
| `vitest` | Testing (dev) |

## File Structure

```
src/
├── index.ts              # Public API exports
├── cli.ts                # CLI entry point (bin)
├── cli/
│   ├── template.ts       # template subcommands (validate, install)
│   ├── generate.ts       # generate subcommands (skill, catalog, agents, all, package, role-package)
│   ├── editor.ts         # visual editor launcher
│   └── prompt-utils.ts   # Interactive prompts for CLI
├── template/
│   ├── types.ts          # All type definitions (incl. LoadoutDefinition, ResolvedLoadout)
│   ├── loader.ts         # YAML parsing, validation, role + loadout inheritance resolution
│   ├── loadout-merge.ts  # Canonical loadout merge rules (exported for consumers)
│   └── install-service.ts # Git-based template installation
└── generators/
    ├── skill-generator.ts        # SKILL.md and catalog generation
    ├── agent-prompt-generator.ts # Agent prompt and role skill generation
    └── package-generator.ts      # Package artifact generation

schema/
├── team.schema.json
├── role.schema.json
└── loadout.schema.json    # JSON Schema for loadouts/<name>.yaml
```
