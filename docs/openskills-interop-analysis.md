# OpenSkills as a Model for OpenTeams Interoperability

## Purpose

This document analyzes the design patterns in [OpenSkills](https://github.com/numman-ali/openskills) — a universal skills loader for AI coding agents — and extracts the principles that should inform how OpenTeams structures its own team and agent packages for cross-platform interoperability.

This is not a direct integration proposal. OpenSkills is studied here as a reference architecture.

## What OpenSkills Gets Right

OpenSkills solves the problem of making Anthropic's SKILL.md format work across any AI agent (Cursor, Windsurf, Aider, Claude Code, etc.). The patterns worth studying:

### 1. Static files as the interop layer

OpenSkills avoids servers, protocols, and runtime dependencies. A skill is just a directory with a SKILL.md file and optional supporting files (`references/`, `scripts/`, `assets/`). Any agent that can read files can consume a skill.

**Lesson for OpenTeams**: The team template format (`team.yaml` + `roles/` + `prompts/`) is already static files. But the *runtime* coordination layer (SQLite + CLI) requires installing OpenTeams. The interop question is: what can an agent learn about a team from its static files alone, before any runtime is available?

### 2. Progressive disclosure

OpenSkills uses a two-phase loading pattern:

- **Catalog phase**: An `AGENTS.md` file contains a compact XML listing of all available skills — just name, description, and location. This is cheap to inject into an agent's context.
- **Load phase**: When an agent needs a skill, it runs `openskills read <name>` to get the full content. The full skill only enters context when needed.

The XML catalog format:

```xml
<skills_system priority="1">
<available_skills>
<skill>
<name>skill-name</name>
<description>One-line description</description>
<location>project</location>
</skill>
</available_skills>
</skills_system>
```

**Lesson for OpenTeams**: Today, OpenTeams has two extremes — `generateSkillMd()` produces a monolithic document with everything (topology, all roles, all communication patterns, all CLI commands), while `generateAgentPrompts()` produces per-role prompts but with no catalog/discovery mechanism. There's no middle layer where an agent can see *what roles exist* without loading all role details.

### 3. Agent-agnostic packaging

OpenSkills stores skills in `.agent/skills/` (universal) vs `.claude/skills/` (Claude-specific). The universal path works for any agent. The SKILL.md format itself is just markdown — no agent-specific constructs required.

**Lesson for OpenTeams**: The `generateAgentPrompts()` output is currently optimized for Claude's Task tool format. Team packages should have an agent-agnostic representation (the YAML template + markdown prompts) and optionally generate agent-specific variants.

### 4. Composability

An agent can have multiple skills loaded simultaneously. Skills are independent — loading one doesn't affect another. Skills can be project-scoped or global, with clear priority rules.

**Lesson for OpenTeams**: A team member agent might need both its *team role context* (from OpenTeams) and *domain-specific skills* (coding patterns, API knowledge, etc.). The team role packaging should be composable with other skill/context systems, not require exclusive control of the agent's context.

## How This Should Shape OpenTeams

### A. Team packages as skill-shaped directories

OpenTeams should adopt the skill directory convention for its own packaging. A team package would look like:

```
my-team/
├── SKILL.md                 # Team overview: topology, role catalog, setup instructions
├── team.yaml                # Source manifest (the authoritative definition)
├── roles/
│   ├── planner/
│   │   └── SKILL.md         # Full planner context: description, communication, CLI
│   ├── grinder/
│   │   └── SKILL.md         # Full grinder context
│   └── judge/
│       └── SKILL.md         # Full judge context
└── prompts/
    ├── planner.md            # Role-specific prompt content
    ├── grinder.md
    └── judge.md
```

The top-level `SKILL.md` serves as the catalog — it describes the team structure and lists roles with one-line descriptions. Each role's `SKILL.md` is a self-contained document that gives an agent everything it needs to act in that role (the output of `generateAgentPrompts()`, restructured as a standalone file).

This is a superset of the current template directory layout. Existing templates would work unchanged; the skill files would be generated artifacts.

### B. A catalog layer between monolithic and per-role

The current generators jump from "everything" to "one role." A middle tier is needed:

| Layer | Content | When to use |
|-------|---------|-------------|
| **Catalog** | Team name, description, role names + one-liners, how to load a role | Always injected (small, ~20 lines) |
| **Role context** | Full role prompt, communication subscriptions, emissions, spawn rules, CLI commands | Loaded on demand when agent takes a role |
| **Full team** | Everything in one document (current `generateSkillMd()` output) | Fallback for agents that can't do progressive loading |

The catalog layer is what OpenSkills' AGENTS.md provides. OpenTeams should generate this as part of `generateSkillMd()` or as a separate `generateCatalog()` function.

Example catalog output:

```markdown
# Team: self-driving

> Autonomous codebase development

## Roles

| Role | Description | Position |
|------|-------------|----------|
| planner | Manages task breakdown and work assignment | root |
| grinder | Claims and executes implementation tasks | spawned |
| judge | Reviews completed work and creates fixups | companion |

## Loading a role

To get full context for a role, read the role's SKILL.md:
- `roles/planner/SKILL.md`
- `roles/grinder/SKILL.md`
- `roles/judge/SKILL.md`

Or via CLI: `openteams generate prompt self-driving --role planner`
```

### C. Agent-agnostic role packages

The per-role SKILL.md files should avoid agent-specific constructs. The current `generateAgentPrompts()` output is good content but its framing assumes Claude. The role package should be:

1. **Identity**: Who you are, what team you're on, your position in the topology
2. **Instructions**: The role's prompt content (from `prompts/<role>.md`)
3. **Communication model**: What channels you subscribe to, what signals you can emit, peer routes — expressed as facts, not as agent-specific commands
4. **Coordination interface**: How to interact with the team — expressed as CLI commands that any agent can run

The CLI commands (`openteams task list`, `openteams message send`, etc.) are already agent-agnostic. They're shell commands. Any agent that can execute shell commands can participate in an OpenTeams team. This is the real interop layer — not a protocol, not an API, just a CLI.

### D. Metadata for discoverability

OpenSkills uses YAML frontmatter in SKILL.md files for machine-readable metadata. OpenTeams role packages should adopt the same convention:

```markdown
---
name: self-driving/planner
description: Plans and coordinates work for the self-driving team
role: planner
team: self-driving
position: root
subscribes: [task_updates, work_coordination]
emits: [TASK_CREATED, WORK_ASSIGNED]
can_spawn: [grinder, planner]
---

# Role: planner
...
```

This makes role packages discoverable by any tool that knows how to parse YAML frontmatter — including tools like OpenSkills, but also any future skill/agent registry.

### E. Generation commands

OpenTeams should add commands to produce these artifacts:

```bash
# Generate the full skill package directory
openteams generate package ./templates/self-driving -o ./packages/self-driving/

# Generate just the catalog
openteams generate catalog self-driving

# Generate a single role's SKILL.md (already partially exists via generate prompt)
openteams generate role-package self-driving --role planner -o ./packages/self-driving/roles/planner/
```

These build on the existing `generateSkillMd()` and `generateAgentPrompts()` functions — they restructure the same content into the package layout.

## What Changes in the Codebase

### New: `src/generators/package-generator.ts`

A generator that takes a `ResolvedTemplate` and produces the full package directory structure:

- Top-level `SKILL.md` with catalog (team overview + role table)
- Per-role `roles/<name>/SKILL.md` with full context
- Copies `team.yaml` and `prompts/` as reference material
- Adds YAML frontmatter to all generated SKILL.md files

### Modified: `src/generators/skill-generator.ts`

Add YAML frontmatter to the existing `generateSkillMd()` output. Add a `generateCatalog()` export for the lightweight catalog layer.

### Modified: `src/generators/agent-prompt-generator.ts`

Add a `generateRoleSkillMd()` function that wraps the existing per-role prompt generation with:
- YAML frontmatter (name, description, team, role, communication summary)
- Agent-agnostic framing (remove Claude-specific language)
- Standalone format (the file should make sense without any surrounding context)

### New CLI command: `openteams generate package`

In `src/cli/generate.ts`, add a `package` subcommand that orchestrates the generation.

## Summary

The key takeaway from OpenSkills is not its specific tooling but its structural model:

1. **Skill-shaped directories** as the unit of packaging — a convention, not a runtime dependency
2. **Progressive disclosure** via catalog → full content, keeping context budgets tight
3. **Agent-agnostic content** that works across platforms because it's just markdown + YAML + shell commands
4. **Composability** — team role packages should coexist with other skill systems, not compete with them

OpenTeams already has the content generators. What's missing is the packaging structure and the catalog layer. Adding these makes every OpenTeams team template portable to any agent that can read files and run shell commands — which is the interoperability goal.
