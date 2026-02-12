# Antfarm Analysis: Relevance to OpenTeams

**Source:** https://github.com/snarktank/antfarm
**Date:** 2026-02-12

## What Is Antfarm?

Antfarm is a TypeScript CLI tool that orchestrates teams of AI agents for software engineering tasks. It targets OpenClaw/Claude Code and ships with three pre-built workflows:

- **feature-dev** (7 agents): Decomposes feature requests into user stories, implements them with tests, verifies, and creates PRs
- **security-audit** (7 agents): Scans repos for vulnerabilities, prioritizes, patches, and re-audits
- **bug-fix** (6 agents): Triages, investigates, patches, and verifies bug reports

Its architecture is deliberately minimal: YAML + SQLite + cron. No Docker, Redis, or Kafka.

## Core Similarities with OpenTeams

| Aspect | OpenTeams | Antfarm |
|--------|-----------|---------|
| Language | TypeScript | TypeScript |
| Persistence | SQLite (better-sqlite3) | SQLite (Node 22 native) |
| Config format | YAML templates | YAML workflows |
| CLI-first | Yes (Commander.js) | Yes (custom) |
| Agent definitions | Roles in `roles/*.yaml` | Agents in `agents/*/` dirs |
| Prompt management | `prompts/<role>/` dirs with `SOUL.md` + `ROLE.md` + `RULES.md` | `AGENTS.md` + `SOUL.md` + `IDENTITY.md` per agent |
| License | MIT | MIT |

Both projects solve the same fundamental problem: **coordinating multiple AI agents on collaborative software tasks**.

## Key Architectural Differences

### 1. Execution Engine vs. Coordination Framework

The biggest difference. OpenTeams provides coordination plumbing (tasks, messages, signals, topology) but doesn't run agents itself — it relies on a pluggable spawner interface. Antfarm ships a complete execution engine with step claiming (`antfarm step claim`), completion (`antfarm step complete`), failure/retry (`antfarm step fail`), and cron-based orchestration.

### 2. Linear Step Pipelines vs. Flexible Topology

Antfarm workflows are sequential step pipelines (plan → setup → implement → verify → test → pr → review) with loop support for iterating over stories. OpenTeams supports richer topologies: parallel tasks, fork/join, wave-based execution, pub/sub channels, and peer routing. Antfarm trades flexibility for determinism and simplicity.

### 3. Fresh Context Per Step ("Ralph Loop")

Antfarm's defining pattern: each agent gets a fresh session per step/story. Context persists only through git history and progress files, not through conversation memory. This avoids context window bloat. OpenTeams doesn't prescribe a context management strategy.

### 4. Built-in Retry and Escalation

Antfarm has first-class retry logic (retry twice, then escalate to human) baked into the step execution engine. OpenTeams leaves retry/escalation to the agent or spawner implementation.

### 5. Web Dashboard

Antfarm ships a web dashboard (port 3333) for real-time monitoring of workflow runs. OpenTeams is CLI-only.

### 6. Story-Based Work Decomposition

Antfarm's feature-dev workflow decomposes tasks into user stories with acceptance criteria, then loops agents through each story. OpenTeams' task system could support this but doesn't prescribe it.

## Ideas Worth Adopting

### 1. Pre-built, Runnable Workflows

Antfarm's strongest feature is workflows that work out of the box. OpenTeams has example templates (BMAD, GSD) but they're reference architectures, not immediately executable workflows. **Recommendation:** Create 2-3 end-to-end runnable workflows (feature-dev, bug-fix, code-review) that produce results immediately after `openteams template load`.

### 2. The "Ralph Loop" / Fresh Context Pattern

Giving each agent a fresh session and persisting state through git + progress files is pragmatic and solves context window exhaustion. **Recommendation:** Formalize this as a recommended execution pattern or built-in mode.

### 3. Step Claim/Complete/Fail Protocol

Antfarm's step lifecycle is simple and effective:
```
claim → execute → complete | fail → retry (2x) → escalate to human
```
OpenTeams has task status tracking but no formal claim/retry/escalation protocol. **Recommendation:** Add a standardized step execution lifecycle to the task service.

### 4. Web Dashboard

A dashboard showing team status, task progress, message flow, and signal events would significantly improve the user experience for long-running multi-agent workflows. **Recommendation:** Build a simple web UI or terminal dashboard.

### 5. Mutual Verification Pattern

Antfarm separates "developer" and "verifier" roles so agents don't self-assess. **Recommendation:** Encode cross-verification as a best practice or template pattern.

### 6. Cron-Based Orchestration

Using cron for agent scheduling is simple and robust — no long-running processes to crash. **Recommendation:** Support a "poll and execute" model alongside the current spawner approach.

### 7. Agent Persona Separation

Antfarm splits agent identity into `SOUL.md` (personality/values), `IDENTITY.md` (role description), and `AGENTS.md` (operational instructions). **Adopted:** OpenTeams now supports multi-file prompt directories with `SOUL.md` (personality/values), `ROLE.md` (operational instructions), and optional `RULES.md` (coding standards/constraints). SOUL.md is always assembled before ROLE.md so agents internalize identity before reading operational rules.

## What OpenTeams Already Does Better

- **Richer communication primitives** — channels, signals, pub/sub, peer routing, enforcement modes
- **Flexible topology** — not limited to linear pipelines; supports parallel, fork/join, wave-based
- **Role inheritance** — composable definitions with `extends` chains
- **Template generators** — SKILL.md and prompt generation from templates
- **Dynamic spawn rules** — which roles can spawn which, enabling runtime team composition
- **Communication enforcement** — strict/audit/permissive modes for topology validation

## Priority Actions

1. **Add an execution engine** — Build on antfarm's step claim/complete/fail model to make OpenTeams workflows self-running
2. **Ship runnable templates** — Convert existing examples into workflows that work end-to-end without customization
3. **Formalize fresh-context pattern** — Support the "Ralph loop" as a first-class execution mode
4. **Add retry/escalation to task service** — First-class retry counts and human escalation triggers
5. **Build a monitoring interface** — Web dashboard or TUI for team/task/message state visibility
