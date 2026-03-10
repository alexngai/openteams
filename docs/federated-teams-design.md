# Federated Teams Design Exploration

> Status: **Exploration** — not a spec, not committed to. This document explores what first-class federation support could look like in OpenTeams.

## The Problem

Teams today are single-template, single-machine constructs. A `team.yaml` defines all roles, all channels, all routing — and a consuming agent system loads and runs it in one process.

But real-world scenarios want teams that span machines:

- A **planning team** on a powerful machine hands off to an **execution team** running on developer laptops
- A **research team** produces artifacts consumed by **implementation teams** across multiple repos
- A **QA team** subscribes to signals from multiple independent development teams
- An **orchestrator** on one machine spawns workers across a fleet

OpenTeams is a definition layer — it shouldn't implement distributed runtimes. But it should provide the **vocabulary** to describe federated deployments so consuming agent systems can implement them.

## Design Principles

1. **Additive** — Federation is layered on top of existing single-team semantics. A non-federated team.yaml works exactly as before.
2. **Definition, not runtime** — OpenTeams describes the federation topology. Agent systems implement the actual distribution.
3. **Composable** — Federated teams are built from standalone teams that can also run independently.
4. **Minimal new concepts** — Reuse channels, signals, routing. Don't invent a new communication model.

## Core Concept: The Federation Manifest

A new file `federation.yaml` sits alongside or above team templates. It declares how multiple teams compose into a federated system.

```yaml
name: distributed-development
version: 1

# The teams in this federation — each is a standalone template
teams:
  planning:
    template: ./planning-team        # path or installed template name
    placement:
      zone: central                  # logical placement hint

  execution:
    template: ./execution-team
    placement:
      zone: edge
      replicas: 3                    # agent system may spawn multiple instances

  qa:
    template: gsd                    # can reference installed/built-in templates
    placement:
      zone: central

# How signals flow between teams
bridges:
  - from:
      team: planning
      signal: PLAN_READY             # signal defined in planning team's emissions
    to:
      team: execution
      channel: incoming_plans        # channel defined in execution team
      signal: PLAN_RECEIVED          # mapped signal name in receiving team

  - from:
      team: execution
      signal: WAVE_COMPLETE
    to:
      team: qa
      channel: verification_events
      signal: WAVE_COMPLETE          # same name — no mapping needed

# Optional: federation-level enforcement
enforcement: audit
```

### Why `bridges` instead of extending `routing`?

Routing (`peers`) describes role-to-role communication *within* a team. Bridges describe team-to-team signal flow *across* boundaries. The distinction matters:

- **Routing** is role-granular — "from planner to executor via direct"
- **Bridges** are team-granular — "planning team's PLAN_READY feeds execution team's incoming_plans channel"
- Agent systems enforce them differently (local dispatch vs. network transport)

The consuming agent system decides *how* to implement a bridge (HTTP, message queue, shared filesystem, MCP, etc.). OpenTeams just declares that the bridge exists.

## Team Boundary Contracts: Exports and Imports

For federation to work, teams need to declare their boundaries — what signals they produce for external consumers and what signals they expect from external sources.

### In team.yaml

```yaml
name: execution-team
version: 1
roles: [executor, verifier]

communication:
  # ... existing channels, subscriptions, emissions ...

  # NEW: Boundary declarations
  exports:
    - signal: WAVE_COMPLETE
      description: "Emitted when all tasks in a wave finish"
    - signal: VERIFICATION_PASSED
      description: "Emitted when verification succeeds"

  imports:
    - channel: incoming_plans
      signals: [PLAN_RECEIVED]
      description: "Plans arriving from an external planning team"
```

**Exports** declare which signals this team makes available to other teams. Only exported signals can be referenced in federation bridge `from` clauses.

**Imports** declare channels that receive signals from outside the team. Import channels are validated differently — they don't need local emitters, since the signals come from bridges.

### Validation Rules

- `exports` signals must exist in the team's `emissions`
- `imports` channels must be referenced in at least one role's `subscriptions`
- Federation bridges can only reference exported signals and imported channels
- A team with no `exports`/`imports` is a closed team — it can still participate in federation but only at the template level (no signal routing)

## Placement and Location

OpenTeams shouldn't model infrastructure (no IPs, no URLs). But it should support **logical placement hints** that agent systems interpret.

### In federation.yaml

```yaml
teams:
  planning:
    template: ./planning-team
    placement:
      zone: central                  # logical zone name
      affinity: [qa]                 # prefer co-locating with these teams
      replicas: 1                    # expected instance count
      constraints:                   # opaque hints for the agent system
        gpu: true
        min_context: 200000
```

### In team.yaml (role-level placement)

```yaml
topology:
  root:
    role: orchestrator
    config:
      model: claude-opus-4-6
      placement:                     # NEW: role-level placement hints
        zone: central
        dedicated: true              # don't share machine with other roles
  spawn_rules:
    orchestrator:
      - role: executor
        max_instances: 4
        placement:
          zone: edge                 # executors run at the edge
```

This extends `TopologyNodeConfig` and `SpawnRuleEntry` with an optional `placement` field. The placement object is intentionally open-ended (`Record<string, unknown>`) — different agent systems will interpret different hints.

## Template Composition API

The programmatic API for loading federated teams:

```typescript
// New type
interface FederationManifest {
  name: string;
  version: number;
  teams: Record<string, FederationTeamEntry>;
  bridges?: FederationBridge[];
  enforcement?: "strict" | "permissive" | "audit";
}

interface FederationTeamEntry {
  template: string;                  // path or template name
  placement?: PlacementConfig;
}

interface PlacementConfig {
  zone?: string;
  affinity?: string[];
  replicas?: number;
  constraints?: Record<string, unknown>;
}

interface FederationBridge {
  from: { team: string; signal: string };
  to: { team: string; channel: string; signal: string };
}

// New type: a loaded federation
interface ResolvedFederation {
  manifest: FederationManifest;
  teams: Map<string, ResolvedTemplate>;  // team key → loaded template
  bridges: FederationBridge[];
}
```

### Loading

```typescript
// New static method
const federation = await TemplateLoader.loadFederation("./my-federation", {
  resolveExternalRole,     // still works — applied per-team
  postProcessRole,
});

// Or compose programmatically
const federation = TemplateLoader.composeFederation({
  name: "my-federation",
  version: 1,
  teams: {
    planning: { template: TemplateLoader.load("./planning-team") },
    execution: { template: TemplateLoader.load("./execution-team") },
  },
  bridges: [
    {
      from: { team: "planning", signal: "PLAN_READY" },
      to: { team: "execution", channel: "incoming_plans", signal: "PLAN_RECEIVED" },
    },
  ],
});
```

### Validation

`loadFederation` validates:

1. All referenced templates load successfully
2. Bridge `from` signals exist in the source team's `exports` (if exports are declared)
3. Bridge `to` channels exist in the destination team's `imports` (if imports are declared)
4. No duplicate team keys
5. No bridge cycles (team A → team B → team A on the same signal)

## Generator Support

### Skill Generation

`generateSkillMd()` already works per-template. For federation, a new generator produces a federated skill catalog:

```typescript
const skillMd = generateFederatedSkillMd(federation, {
  includeTeamBoundaries: true,   // show exports/imports
  includeBridges: true,          // show cross-team signal flow
});
```

### Agent Prompt Generation

Agent prompts need federation context — an agent in team A needs to know it will receive signals from team B:

```typescript
const prompts = generateFederatedAgentPrompts(federation, {
  teamName: "execution",         // generate prompts for one team
  includeBridgeContext: true,    // inject bridge metadata into prompts
});
```

The generated prompt for an executor role might include:

```markdown
## Cross-Team Signals

This team receives signals from external teams:
- **PLAN_RECEIVED** on channel `incoming_plans` — from the planning team

This team exports signals to other teams:
- **WAVE_COMPLETE** — consumed by the qa team
```

## Worked Example: Distributed GSD

Imagine splitting the GSD 12-role team into three federated teams:

```
federation.yaml
planning-team/          # project-researcher, phase-researcher, research-synthesizer,
                        # roadmapper, planner, plan-checker
execution-team/         # orchestrator, executor, debugger, codebase-mapper
verification-team/      # verifier, integration-checker
```

```yaml
# federation.yaml
name: distributed-gsd
version: 1

teams:
  planning:
    template: ./planning-team
    placement:
      zone: central
      constraints:
        min_context: 200000

  execution:
    template: ./execution-team
    placement:
      zone: edge
      replicas: 3

  verification:
    template: ./verification-team
    placement:
      zone: central
      affinity: [planning]

bridges:
  # Planning → Execution
  - from: { team: planning, signal: PLAN_VALIDATED }
    to: { team: execution, channel: incoming_plans, signal: PLAN_RECEIVED }

  # Execution → Verification
  - from: { team: execution, signal: WAVE_COMPLETE }
    to: { team: verification, channel: execution_results, signal: WAVE_READY_FOR_REVIEW }

  # Verification → Planning (gaps found → re-plan)
  - from: { team: verification, signal: GAPS_FOUND }
    to: { team: planning, channel: feedback, signal: GAPS_REPORTED }

  # Verification → Execution (passed → continue)
  - from: { team: verification, signal: VERIFICATION_PASSED }
    to: { team: execution, channel: verification_results, signal: VERIFICATION_PASSED }
```

Each sub-team can also run independently — the planning team works fine on its own, producing PLAN_VALIDATED signals that go nowhere if there's no bridge to consume them.

## What This Doesn't Cover (Intentionally)

These are **runtime concerns** that belong to consuming agent systems, not to OpenTeams:

- **Transport protocol** — How bridges are implemented (HTTP, gRPC, shared filesystem, message queue)
- **Service discovery** — How teams find each other at runtime
- **State synchronization** — How shared artifacts (files, databases) are kept in sync
- **Failure handling** — What happens when a bridged team is unavailable
- **Authentication** — How teams verify each other's identity
- **Ordering guarantees** — Whether bridge delivery is ordered, at-least-once, etc.

Agent systems that consume federation manifests are responsible for all of the above. OpenTeams provides the structural contract; they provide the runtime.

## Implementation Path

If we decide to build this, a reasonable order:

1. **Exports/imports in `CommunicationConfig`** — smallest change, immediately useful for documenting team boundaries even without federation
2. **`FederationManifest` types and loader** — parse `federation.yaml`, validate bridges against exports/imports
3. **`PlacementConfig` on topology nodes** — extend `TopologyNodeConfig` and `SpawnRuleEntry`
4. **Federation-aware generators** — skill catalogs and agent prompts that include bridge context
5. **CLI support** — `openteams federation validate`, `openteams federation generate`

Step 1 is independently useful — even without federation, explicit exports/imports make team boundaries clearer and enable better validation.

## Open Questions

1. **Should bridges support signal transformation?** The current design allows signal *renaming* (PLAN_READY → PLAN_RECEIVED) but not transformation. Should bridges support mapping payloads?

2. **Should teams be able to share roles?** The current design keeps teams fully independent. An alternative: a shared role pool that multiple teams reference. This adds complexity but avoids duplicating common roles.

3. **Should federation support hierarchical composition?** Can a federation contain other federations? This enables recursive scaling but adds complexity. Probably not needed for v1.

4. **How should `resolveExternalRole` interact with federation?** Should the federation loader automatically wire up cross-team role resolution, so a role in team A can `extends` a role in team B?

5. **Should bridges be bidirectional shorthand?** Many real patterns are request/response (PLAN_READY → PLAN_RECEIVED, VERIFICATION_PASSED → continue). Should there be syntactic sugar for this?
