<div align="center">
    <picture>
        <img alt="openteams banner" src="https://raw.githubusercontent.com/alexngai/openteams/main/media/banner.png">
    </picture>
</div>

# openteams

[![npm version](https://img.shields.io/npm/v/openteams.svg?style=flat-square)](https://www.npmjs.com/package/openteams)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-green.svg?style=flat-square)](https://nodejs.org)

A definition layer for multi-agent team structures. Define roles, topology, communication channels, and prompts in YAML — agent systems (Claude Code, Gemini, Codex, etc.) consume the structure and map it to their own runtime primitives.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Template System](#template-system)
- [Communication Topology](#communication-topology)
- [CLI Command Reference](#cli-command-reference)
- [Library Usage](#library-usage)
- [Examples](#examples)
- [Visual Editor](#visual-editor)
- [Contributing](#contributing)
- [License](#license)

---

## What It Does

OpenTeams is **not** a runtime coordination system. It does not manage state, spawn agents, or track tasks. Instead, it provides:

- **YAML team templates.** Declare roles, topology, spawn rules, communication channels, and enforcement in a `team.yaml` directory. One format, any agent system.
- **Role inheritance.** Roles extend other roles with capability composition (`add`/`remove`). Multi-level chains resolved at load time with cycle detection.
- **Communication topology.** Typed signal channels with role subscriptions, emission permissions, peer routing, and enforcement modes — all as structural metadata.
- **Prompt loading.** Single-file or multi-file prompts per role, loaded and resolved alongside the template.
- **Generators.** Produce SKILL.md files, role catalogs, agent prompts, and deployable packages from a template directory.
- **Template installation.** Clone and install templates from git repositories.
- **Visual editor.** Interactive browser-based UI for editing team configurations.

Agent systems read the resolved template and implement runtime behavior (task management, messaging, agent spawning, enforcement) using their own primitives.

---

![openteams editor](https://raw.githubusercontent.com/alexngai/openteams/main/media/editor.png)

NEW! [openteams frontend-only config editor](https://team-config.swarmkit.ai/)

---

## Quick Start

**Prerequisites:** Node.js >= 18

```bash
npm install -g openteams
```

### Validate a template

```bash
openteams template validate ./examples/get-shit-done
```

```
Template "get-shit-done" is valid.
  Version: 1
  Roles: orchestrator, roadmapper, planner, plan-checker, executor, verifier ...
  Root: orchestrator
  Channels: project_lifecycle, planning_events, execution_events, verification_events
```

### Generate artifacts

```bash
# Generate SKILL.md + agent prompt files
openteams generate all ./examples/get-shit-done -o ./output/gsd
```

```
Generated ./output/gsd/SKILL.md
  orchestrator -> ./output/gsd/agents/orchestrator.md
  planner -> ./output/gsd/agents/planner.md
  ...

Generated SKILL.md + 12 agent prompt(s) for team "get-shit-done"
```

### Install a template from git

```bash
openteams template install owner/repo
```

---

## Architecture

```
src/
  cli.ts                 # Entry point: template, generate, editor commands
  index.ts               # Public API exports
  cli/                   # CLI command definitions
  template/
    loader.ts            # TemplateLoader — YAML parsing, role inheritance, prompt loading
    types.ts             # All type definitions
    install-service.ts   # Git-based template installation
  generators/
    skill-generator.ts   # generateSkillMd(), generateCatalog()
    agent-prompt-generator.ts  # generateAgentPrompts(), generateRoleSkillMd()
    package-generator.ts # generatePackage()
schema/
  team.schema.json       # JSON Schema for team.yaml
  role.schema.json       # JSON Schema for role YAML
examples/
  get-shit-done/         # 12-role team with wave-based execution
  bmad-method/           # 10-role agile development team
```

No database. No runtime state. Templates are the source of truth.

---

## Template System

A template is a directory that declares a team structure in YAML.

### Directory Structure

```
templates/my-team/
├── team.yaml              # Manifest: topology, communication, role list
├── roles/
│   ├── planner.yaml       # Role definition with capabilities
│   └── executor.yaml
├── prompts/
│   ├── planner.md         # Single-file prompt (simple roles)
│   └── executor/          # Multi-file prompt directory (complex roles)
│       ├── SOUL.md        # Personality, values, communication style
│       ├── ROLE.md        # Operational instructions (primary)
│       └── RULES.md       # Constraints (optional)
└── tools/
    └── mcp-servers.json   # MCP server config per role (optional)
```

### Minimal team.yaml

```yaml
name: my-team
version: 1
roles: [coordinator, worker]

topology:
  root:
    role: coordinator
  spawn_rules:
    coordinator: [worker]
    worker: []
```

### Full team.yaml with communication

```yaml
name: self-driving
description: "Autonomous codebase development"
version: 1
roles: [planner, grinder, judge]

topology:
  root:
    role: planner
    prompt: prompts/planner.md
    config: { model: sonnet }
  companions:
    - role: judge
      prompt: prompts/judge.md
  spawn_rules:
    planner: [grinder, planner]
    judge: []
    grinder: []

communication:
  enforcement: audit
  channels:
    task_updates:
      description: "Task lifecycle events"
      signals: [TASK_CREATED, TASK_COMPLETED, TASK_FAILED]
    work_coordination:
      signals: [WORK_ASSIGNED, WORKER_DONE]
  subscriptions:
    planner:
      - channel: task_updates
      - channel: work_coordination
        signals: [WORKER_DONE]
    judge:
      - channel: task_updates
        signals: [TASK_FAILED]
    grinder:
      - channel: work_coordination
        signals: [WORK_ASSIGNED]
  emissions:
    planner: [TASK_CREATED, WORK_ASSIGNED]
    grinder: [WORKER_DONE]
  routing:
    peers:
      - from: judge
        to: planner
        via: direct
        signals: [FIXUP_CREATED]

# Extension fields: stored but not interpreted by openteams
macro_agent:
  task_assignment: { mode: pull }
```

### Role Definitions

Roles live in `roles/<name>.yaml` and support single inheritance via `extends`:

```yaml
# roles/senior-dev.yaml
name: senior-dev
capabilities: [code, review, deploy]

# roles/junior-dev.yaml
name: junior-dev
extends: senior-dev
capabilities:
  add: [debug]
  remove: [deploy]
# Resolved capabilities: [code, review, debug]
```

Multi-level chains (`A extends B extends C`) are resolved in topological order. Circular inheritance is detected and rejected at load time.

---

## Communication Topology

Communication config is structural metadata that agent systems read and implement. OpenTeams defines the contract; enforcement is up to the consuming system.

### Channels and Signals

A channel groups related signals. Roles subscribe to channels with optional signal-level filtering.

```yaml
subscriptions:
  analyst:
    - channel: phase_transitions        # receives all signals
  pm:
    - channel: phase_transitions
      signals: [ANALYSIS_COMPLETE]     # receives only this signal
```

### Peer Routes

Direct role-to-role routing for specific signals. Three modes:

| Via | Meaning |
|-----|---------|
| `direct` | Signal is routed directly from one role to another |
| `topic` | Signal is routed via a named topic |
| `scope` | Signal is scoped to a context boundary |

### Enforcement Modes

Set via `communication.enforcement` in the manifest. Interpretation is left to the consuming agent system.

| Mode | Intent |
|------|--------|
| `permissive` (default) | All signal emissions allowed regardless of declared permissions |
| `audit` | Unauthorized emissions are flagged but not blocked |
| `strict` | Unauthorized emissions should be rejected |

---

## CLI Command Reference

### Template

| Command | Description |
|---------|-------------|
| `openteams template validate <dir>` | Validate a template without side effects |
| `openteams template install <repo-url> [name]` | Install a template from a git repository |

**Options for `template install`:**

| Flag | Description |
|------|-------------|
| `-o, --output <path>` | Install to a specific directory |
| `-y, --yes` | Skip confirmation prompts |

### Generate

Generate artifacts from a template directory.

| Command | Description |
|---------|-------------|
| `openteams generate skill <dir>` | Generate `SKILL.md` from a template |
| `openteams generate catalog <dir>` | Generate a lightweight role catalog |
| `openteams generate agents <dir>` | Generate one prompt file per role |
| `openteams generate all <dir>` | Generate `SKILL.md` + all agent prompts |
| `openteams generate package <dir>` | Generate a deployable skill package directory |
| `openteams generate role-package <dir> -r <role>` | Generate a standalone `SKILL.md` for one role |

All `generate` commands accept `-n, --name <name>` to override the team name and `-o, --output <path>` to control output location.

### Editor

| Command | Description |
|---------|-------------|
| `openteams editor` | Launch visual team configuration editor |

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-d, --dir <path>` | cwd | Template directory to load |
| `-p, --port <port>` | `5173` | Port for the editor server |

---

## Library Usage

```bash
npm install openteams
```

### Loading Templates

```typescript
import { TemplateLoader } from "openteams";

// Load from a directory
const template = TemplateLoader.load("./examples/get-shit-done");

console.log(template.manifest.name);        // "get-shit-done"
console.log(template.manifest.roles);        // ["orchestrator", "roadmapper", ...]
console.log(template.manifest.topology);     // { root, companions, spawn_rules }
console.log(template.manifest.communication); // { channels, subscriptions, emissions, routing }

// Access resolved roles (after inheritance)
const planner = template.roles.get("planner");
console.log(planner.capabilities);           // ["plan", "coordinate", ...]

// Access loaded prompts
const prompts = template.prompts.get("planner");
console.log(prompts.primary);               // Content of prompt.md or ROLE.md
console.log(prompts.additional);            // Additional prompt sections
```

### Async Loading with Hooks

```typescript
import { TemplateLoader } from "openteams";

const template = await TemplateLoader.loadAsync("./my-team", {
  resolveExternalRole: async (name) => {
    // Resolve roles not found in the local roles/ directory
    return fetchRoleFromRegistry(name);
  },
  postProcessRole: (role, manifest) => {
    // Enrich roles after inheritance resolution
    return { ...role, description: `${role.description} (enriched)` };
  },
  postProcess: (template) => {
    // Transform the entire template after loading
    return template;
  },
});
```

### Generating Artifacts

```typescript
import { TemplateLoader, generateSkillMd, generateAgentPrompts, generatePackage } from "openteams";

const template = TemplateLoader.load("./my-team");

// Generate SKILL.md content
const skillMd = generateSkillMd(template, { teamName: "my-team" });

// Generate per-role prompt files
const prompts = generateAgentPrompts(template, { teamName: "my-team" });
for (const p of prompts) {
  console.log(`${p.role}: ${p.prompt.length} chars`);
}

// Generate a deployable package (writes files to disk)
const pkg = generatePackage(template, { teamName: "my-team", outputDir: "./out" });
```

### Installing Templates

```typescript
import { TemplateInstallService } from "openteams";

const installer = new TemplateInstallService();
const result = await installer.install(
  { repoUrl: "owner/repo" },
  {
    selectTemplate: async (templates) => templates[0].name,
    confirmGlobalInstall: async () => true,
    onProgress: (msg) => console.log(msg),
  }
);
console.log(`Installed to: ${result.installedPath}`);
```

---

## Examples

Two complete team templates are included in the `examples/` directory.

### BMAD Method (`examples/bmad-method/`)

A 10-role agile development team structured around four phases: analysis, planning, solutioning, and implementation.

**Roles:** `master`, `analyst`, `pm`, `ux-designer`, `architect`, `scrum-master`, `developer`, `qa`, `tech-writer`, `quick-flow-dev`

**Channels:** `phase_transitions`, `artifact_ready`, `sprint_events`, `quality_events`

**Enforcement:** `audit`

### Get Shit Done (`examples/get-shit-done/`)

A 12-role autonomous development system with wave-based parallel execution.

```mermaid
flowchart TD
    O["orchestrator\n(root)"] -->|spawns| R["roadmapper"]
    O -->|spawns| PR["project-researcher"]
    O -->|spawns| CM["codebase-mapper"]
    O -->|spawns| P["planner"]
    O -->|spawns| PC["plan-checker"]
    O -->|spawns| E1["executor ×N"]
    O -->|spawns| V["verifier"]
    O -->|spawns| IC["integration-checker"]
```

The orchestrator runs a research phase, produces a roadmap, validates a plan, then spawns executor waves. Verifiers check each completed phase.

**Channels:** `project_lifecycle`, `planning_events`, `execution_events`, `verification_events`

**Enforcement:** `permissive`

```bash
openteams template validate ./examples/get-shit-done
openteams generate all ./examples/get-shit-done -o ./output/gsd
```

---

## Visual Editor

OpenTeams includes a browser-based visual editor for designing and editing team configurations. Load any bundled example template or start from a blank canvas, then visually arrange roles, channels, communication topology, and spawn rules.

**Features:**

- **Canvas-based editing.** Drag and connect role and channel nodes. Auto-layout for quick organization.
- **Template library.** Load any example template from a dropdown, or clear the canvas to start fresh.
- **Inspector panel.** Edit role identity, communication subscriptions, emissions, peer routes, spawn rules, capabilities, and prompts.
- **Layer toggles.** Show or hide peer routes, signal flow edges, spawn rules, and inheritance edges independently.
- **Import/Export.** Paste raw YAML to import, or export the current configuration as a downloadable template directory (zip).
- **Validation.** Real-time error and warning indicators for missing references, orphaned signals, and schema issues.
- **Light/dark theme.** Toggle between dark, light, and system themes.

### Running the editor

```bash
# Via CLI (serves the built editor)
openteams editor

# For development
cd editor
npm run dev
```

---

## Contributing

```bash
git clone <repo>
cd openteams
npm install
npm run build
npm test
```

Run a single test file:

```bash
npx vitest run src/template/loader.test.ts
```

No database or external services required. Tests use filesystem fixtures and inline manifests.

---

## License

MIT
