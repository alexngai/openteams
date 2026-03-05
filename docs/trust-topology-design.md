# Trust Topology — Design Specification

## 1. Motivation

OpenTeams defines multi-agent team structures as declarative YAML. It already models communication topology (channels, signals, subscriptions, routing) and enforcement modes (strict/audit/permissive). However, **verification** — the process by which agent output is validated before downstream work proceeds — is currently implicit: it exists only as roles with suggestive names (verifier, plan-checker) and signal conventions (PLAN_VALIDATED, FIX_VERIFIED).

Michael Rothrock's [Trust Topology](https://michael.roth.rocks/) framework provides a rigorous vocabulary for reasoning about verification pipelines in AI agent systems. Over 97 days and 5,109 gate checks, it demonstrates that **reliability is a property of the arrangement of verification gates, not the capability of any individual model**. The framework identifies four diagnostic properties — overlap ratio, verification amplification, the deterministic ceiling, and the liveness constraint — that determine whether a gate topology actually works.

This design proposes making verification gates a first-class construct in OpenTeams, giving template authors a structured way to declare what gets verified, how, and by whom — while staying true to OpenTeams' role as a definition layer that does not manage runtime.

### Design Principles

1. **Additive.** All new constructs are optional. Existing templates remain valid without modification.
2. **Definition layer only.** OpenTeams declares gate topology. Consuming agent systems (Claude Code, Gemini, Codex) interpret and enforce it.
3. **Backward compatible.** The existing `communication` section is untouched. Gates compose with channels and signals, they don't replace them.
4. **Minimal viable surface.** Start with the constructs that provide the most value. Defer anything that requires runtime state.

---

## 2. Concepts

### 2.1 Gates

A **gate** is a named verification checkpoint between pipeline stages. Each gate declares:

- **What artifact** it checks (plan, design, code, test, etc.)
- **What kind** of verification it performs (deterministic, stochastic, oracle)
- **What it can prove** and what it cannot
- **What happens on failure** (retry, escalate, block)

Gates are distinct from roles. A role *implements* a gate, but the gate is a structural concept in the topology that exists independent of which role fills it. This separation lets template authors reason about their verification pipeline's shape before deciding who (or what) performs each check.

### 2.2 Verification Tiers

Rothrock identifies three verification regimes. OpenTeams formalizes them as gate `kind` values:

| Kind | Description | Examples | Cost | Guarantee |
|------|-------------|----------|------|-----------|
| `deterministic` | Mechanically checkable, produces hard pass/fail | Tests, linting, type checking, schema validation | Near-zero | Provable |
| `stochastic` | LLM-based judgment, probabilistic | "Does this design satisfy the requirements?" | Moderate | Estimated |
| `oracle` | Human judgment, ground truth | Architectural decisions, ambiguous requirements | High | Definitive |

### 2.3 The Four Diagnostic Properties

These are not things OpenTeams enforces — they are properties that template authors reason about and that tooling can surface:

| Property | Question | OpenTeams Relevance |
|----------|----------|---------------------|
| **Overlap ratio** | Are my gates catching different errors? | Template validation can warn when two gates check the same artifact with the same kind |
| **Verification amplification** | Do upstream gates reduce downstream burden? | Gate ordering declares this; generators can document the pipeline shape |
| **Deterministic ceiling** | What can my gates actually prove? | The `proves` / `cannot_prove` fields make this explicit |
| **Liveness constraint** | Can the system still produce output? | `max_retries` prevents retry storms |

### 2.4 Escalation (Oracle Routing)

When a stochastic gate cannot confidently classify a failure, it escalates. Escalation is the only mechanism that recovers information about human intent — every other stage can only lose it. OpenTeams models this as a gate-level `on_failure` policy with an explicit escalation target.

---

## 3. Schema Additions

### 3.1 Team Manifest (`team.yaml`)

A new optional top-level `verification` section, peer to the existing `communication` section:

```yaml
verification:
  # Global defaults (can be overridden per-gate)
  defaults:
    max_retries: 3
    on_failure: block

  # Ordered list of gates — order implies pipeline sequence
  gates:
    - name: plan-review
      artifact: plan
      kind: stochastic
      role: plan-checker          # which role implements this gate
      proves: [requirements_coverage, task_decomposition]
      cannot_prove: [intent_alignment]
      on_failure: retry
      max_retries: 3

    - name: design-review
      artifact: design
      kind: stochastic
      role: plan-checker
      proves: [architectural_coherence, interface_consistency]
      cannot_prove: [performance_characteristics]
      on_failure: retry
      max_retries: 2

    - name: static-analysis
      artifact: code
      kind: deterministic
      proves: [type_safety, lint_compliance, syntax_validity]
      cannot_prove: [semantic_correctness, intent_alignment]
      on_failure: retry

    - name: test-suite
      artifact: code
      kind: deterministic
      proves: [behavioral_correctness_for_covered_paths]
      cannot_prove: [uncovered_edge_cases, integration_behavior]
      on_failure: block

    - name: code-review
      artifact: code
      kind: stochastic
      role: verifier
      scope: system                # "file" | "system" — observation window
      proves: [cross_file_consistency, requirement_satisfaction]
      cannot_prove: [intent_alignment, taste]
      on_failure:
        auto_fixable: retry
        ambiguous: escalate
      escalate_to: human           # oracle routing target
      max_retries: 2

  # Escalation configuration
  escalation:
    default_target: human
    signals:
      escalated: VERIFICATION_ESCALATED
      resolved: ESCALATION_RESOLVED
```

### 3.2 Gate Definition Schema

```json
{
  "GateDefinition": {
    "type": "object",
    "required": ["name", "artifact", "kind"],
    "properties": {
      "name": {
        "type": "string",
        "pattern": "^[a-zA-Z0-9][a-zA-Z0-9_-]*$",
        "description": "Unique gate identifier."
      },
      "artifact": {
        "type": "string",
        "description": "What kind of artifact this gate checks.",
        "examples": ["plan", "design", "code", "test", "spec"]
      },
      "kind": {
        "type": "string",
        "enum": ["deterministic", "stochastic", "oracle"],
        "description": "Verification tier. Deterministic gates produce provable pass/fail. Stochastic gates use LLM judgment. Oracle gates require human decision."
      },
      "role": {
        "type": "string",
        "description": "Role that implements this gate. Optional for deterministic gates (may be tooling-only)."
      },
      "scope": {
        "type": "string",
        "enum": ["file", "system"],
        "description": "Observation window. File-scoped gates cannot detect cross-context contradictions."
      },
      "proves": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Properties this gate can verify with confidence. Makes the deterministic ceiling explicit."
      },
      "cannot_prove": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Properties this gate explicitly cannot verify. Documents the gap above the deterministic ceiling."
      },
      "on_failure": {
        "oneOf": [
          {
            "type": "string",
            "enum": ["retry", "block", "escalate"],
            "description": "Simple failure policy."
          },
          {
            "type": "object",
            "properties": {
              "auto_fixable": {
                "type": "string",
                "enum": ["retry", "block"],
                "description": "Policy for errors the gate classifies as auto-fixable."
              },
              "ambiguous": {
                "type": "string",
                "enum": ["escalate", "block"],
                "description": "Policy for errors that require human judgment."
              }
            },
            "description": "Compound failure policy with oracle routing."
          }
        ]
      },
      "escalate_to": {
        "type": "string",
        "description": "Target for escalation. 'human' or a role name.",
        "default": "human"
      },
      "max_retries": {
        "type": "integer",
        "minimum": 0,
        "description": "Maximum retry attempts before blocking or escalating. Liveness constraint."
      }
    }
  }
}
```

### 3.3 Integration with Communication

Gates participate in the existing communication topology through signals. When a gate passes or fails, it emits signals on the appropriate channels. Template authors wire this up using the existing `emissions` and `subscriptions` system — gates don't replace channels, they add structure on top.

The `verification.escalation.signals` field declares which signal names are used for escalation events, allowing consuming systems to route them appropriately.

---

## 4. Type Additions

New types in `src/template/types.ts`:

```typescript
// --- Verification Gates ---

export type GateKind = "deterministic" | "stochastic" | "oracle";

export type SimpleFailurePolicy = "retry" | "block" | "escalate";

export interface CompoundFailurePolicy {
  auto_fixable: "retry" | "block";
  ambiguous: "escalate" | "block";
}

export interface GateDefinition {
  name: string;
  artifact: string;
  kind: GateKind;
  role?: string;                    // role implementing this gate
  scope?: "file" | "system";       // observation window
  proves?: string[];                // what this gate can verify
  cannot_prove?: string[];          // explicit gaps (deterministic ceiling)
  on_failure?: SimpleFailurePolicy | CompoundFailurePolicy;
  escalate_to?: string;            // "human" or role name
  max_retries?: number;            // liveness constraint
}

export interface EscalationConfig {
  default_target?: string;          // default escalation target
  signals?: {
    escalated?: string;             // signal emitted on escalation
    resolved?: string;              // signal emitted when resolved
  };
}

export interface VerificationConfig {
  defaults?: {
    max_retries?: number;
    on_failure?: SimpleFailurePolicy;
  };
  gates?: GateDefinition[];         // ordered — sequence implies pipeline
  escalation?: EscalationConfig;
}
```

Update `TeamManifest`:

```typescript
export interface TeamManifest {
  name: string;
  description?: string;
  version: number;
  roles: string[];
  topology: TopologyConfig;
  communication?: CommunicationConfig;
  verification?: VerificationConfig;  // NEW

  macro_agent?: Record<string, unknown>;
  [key: string]: unknown;
}
```

---

## 5. Generator Output

### 5.1 Skill Markdown

`generateSkillMd()` already renders the communication section. It should also render the verification pipeline:

```markdown
## Verification Pipeline

This team uses 5 gates in sequence. Gates are ordered by pipeline stage.

| # | Gate | Artifact | Kind | Scope | Proves | On Failure |
|---|------|----------|------|-------|--------|------------|
| 1 | plan-review | plan | stochastic | — | requirements_coverage, task_decomposition | retry (max 3) |
| 2 | design-review | design | stochastic | — | architectural_coherence, interface_consistency | retry (max 2) |
| 3 | static-analysis | code | deterministic | — | type_safety, lint_compliance | retry |
| 4 | test-suite | code | deterministic | — | behavioral_correctness_for_covered_paths | block |
| 5 | code-review | code | stochastic | system | cross_file_consistency, requirement_satisfaction | auto-fix → retry, ambiguous → escalate |

### Deterministic Ceiling

The following properties are **provable** by deterministic gates:
- type_safety, lint_compliance, syntax_validity (static-analysis)
- behavioral_correctness_for_covered_paths (test-suite)

The following properties require **stochastic judgment**:
- requirements_coverage, task_decomposition (plan-review)
- architectural_coherence (design-review)
- cross_file_consistency, requirement_satisfaction (code-review)

The following properties are **explicitly unverifiable** by this pipeline:
- intent_alignment (no gate proves this — requires oracle escalation)
- taste (no gate proves this)
- uncovered_edge_cases (test-suite cannot_prove)
- performance_characteristics (design-review cannot_prove)

### Escalation

When a gate classifies an error as ambiguous, it escalates to: **human**
Escalation signal: VERIFICATION_ESCALATED
Resolution signal: ESCALATION_RESOLVED
```

### 5.2 Agent Prompts

`generateAgentPrompts()` should inject gate-awareness into each role's prompt:

- **Gate implementors** get their gate's `proves` and `cannot_prove` lists, so they know their verification scope.
- **Generators** (roles whose output flows through gates) get a summary of what downstream gates will check, so they can front-load quality.
- **Orchestrators** get the full pipeline overview and escalation routing rules.

---

## 6. Template Validation

`openteams template validate` should check:

### 6.1 Structural Validation
- Gate names are unique
- Gate `role` references exist in the top-level `roles` list
- Gate `escalate_to` references a valid role or `"human"`
- `max_retries` is non-negative

### 6.2 Topology Warnings (Non-Blocking)

Inspired by Trust Topology's diagnostic properties:

| Warning | Rationale |
|---------|-----------|
| **High overlap** | Two gates with same `artifact` and same `kind` — "one gate running twice" |
| **Scope gap** | All code gates are `scope: file` — no gate can observe cross-context contradictions (0% incoherence detection) |
| **No deterministic gates** | Pipeline relies entirely on stochastic judgment — no hard guarantees |
| **No escalation path** | Stochastic gates exist but no `escalate_to` is configured — oracle routing is missing |
| **Liveness risk** | Total `max_retries` across all gates is very high — risk of retry storms |
| **Unverifiable gap** | A property appears in `cannot_prove` for every gate — nothing in the pipeline can check it |

---

## 7. Worked Example: Bug-Fix Pipeline

The existing `examples/bug-fix-pipeline/team.yaml` has an implicit verification gate (the verifier role). Here's how it would look with explicit gate declarations:

```yaml
name: bug-fix-pipeline
description: "Linear pipeline for autonomous bug fixing"
version: 1
roles:
  - triager
  - investigator
  - fixer
  - verifier
  - pr-creator

topology:
  root:
    role: triager
  spawn_rules:
    triager: [investigator]
    investigator: [fixer]
    fixer: [verifier]
    verifier: [pr-creator]
    pr-creator: []

verification:
  defaults:
    max_retries: 2
    on_failure: retry

  gates:
    - name: triage-check
      artifact: bug-report
      kind: stochastic
      role: triager
      proves: [severity_classification, reproducibility_assessment]
      cannot_prove: [root_cause]
      on_failure: block    # bad triage is expensive downstream

    - name: fix-tests
      artifact: code
      kind: deterministic
      proves: [tests_pass, no_regressions]
      cannot_prove: [fix_correctness, edge_cases]
      on_failure: retry

    - name: fix-verification
      artifact: code
      kind: stochastic
      role: verifier
      scope: system
      proves: [fix_addresses_root_cause, no_side_effects]
      cannot_prove: [long_term_maintainability]
      on_failure:
        auto_fixable: retry
        ambiguous: escalate
      escalate_to: human
      max_retries: 2

  escalation:
    default_target: human
    signals:
      escalated: VERIFICATION_ESCALATED
      resolved: ESCALATION_RESOLVED

communication:
  enforcement: strict
  # ... (existing channels, subscriptions, emissions, routing unchanged)
```

This makes several things visible that were previously implicit:

1. **The triage gate blocks on failure** — bad triage wastes all downstream effort (verification amplification).
2. **Tests are deterministic** — they prove regressions didn't happen but can't prove the fix is correct (deterministic ceiling).
3. **The verifier has a compound failure policy** — auto-fixable issues retry, ambiguous ones escalate to a human (oracle routing).
4. **`long_term_maintainability` is explicitly unverifiable** — no gate in this pipeline can assess it.

---

## 8. Worked Example: GSD Team

The GSD template's 12-role structure maps naturally to a richer gate topology:

```yaml
verification:
  defaults:
    max_retries: 3

  gates:
    - name: research-synthesis
      artifact: research
      kind: stochastic
      role: research-synthesizer
      proves: [source_coverage, factual_consistency]
      cannot_prove: [strategic_relevance]

    - name: plan-validation
      artifact: plan
      kind: stochastic
      role: plan-checker
      proves: [requirements_coverage, task_decomposition, dependency_ordering]
      cannot_prove: [effort_estimation, intent_alignment]
      on_failure: retry
      max_retries: 3

    - name: wave-tests
      artifact: code
      kind: deterministic
      proves: [tests_pass, type_safety, lint_compliance]
      cannot_prove: [semantic_correctness, integration_behavior]

    - name: goal-backward-verification
      artifact: code
      kind: stochastic
      role: verifier
      scope: system
      proves: [requirement_satisfaction, cross_component_consistency]
      cannot_prove: [intent_alignment, performance, ux_quality]
      on_failure:
        auto_fixable: retry
        ambiguous: escalate
      escalate_to: human

    - name: integration-check
      artifact: code
      kind: stochastic
      role: integration-checker
      scope: system
      proves: [cross_phase_compatibility, api_contract_adherence]
      cannot_prove: [runtime_behavior_under_load]
      on_failure: retry

  escalation:
    default_target: human
    signals:
      escalated: VERIFICATION_ESCALATED
      resolved: ESCALATION_RESOLVED
```

Key observations this surfaces:

- **plan-validation** and **goal-backward-verification** check different artifacts (plan vs code) — low overlap, good pipeline.
- **wave-tests** (deterministic) and **goal-backward-verification** (stochastic) check the same artifact (code) but at different tiers — this is the deterministic ceiling in action.
- **intent_alignment** appears in `cannot_prove` for every gate — only the human oracle can verify it.
- **integration-check** is a second stochastic code gate with different `proves` than **goal-backward-verification** — complementary, not redundant.

---

## 9. Implementation Plan

### Phase 1: Types and Schema
1. Add `VerificationConfig`, `GateDefinition`, and related types to `src/template/types.ts`
2. Add `verification` section to `schema/team.schema.json`
3. Update `TemplateLoader` to parse the verification section
4. Tests for loading templates with verification configs

### Phase 2: Validation
1. Add structural validation (reference checking) to `TemplateLoader` or a new validator
2. Add topology warnings (overlap, scope gaps, liveness) as non-blocking diagnostics
3. Wire into `openteams template validate` CLI command
4. Tests for each warning condition

### Phase 3: Generator Output
1. Update `generateSkillMd()` to render the verification pipeline table
2. Update `generateAgentPrompts()` to inject gate context into role prompts
3. Render the deterministic ceiling summary
4. Tests for generated output

### Phase 4: Examples
1. Add `verification` section to `examples/bug-fix-pipeline/team.yaml`
2. Add `verification` section to `examples/gsd/team.yaml`
3. Update example READMEs if they exist

---

## 10. What This Does NOT Cover

Staying true to OpenTeams as a definition layer, this design explicitly excludes:

- **Runtime gate execution** — consuming systems implement the gates; OpenTeams only declares them
- **Metrics collection** — overlap ratio and verification amplification are measured at runtime, not at definition time
- **Boundary migration** — the dynamic where stochastic patterns graduate to deterministic rules requires runtime learning; OpenTeams could eventually model a `knowledge_base` section but this is deferred
- **Revision cycle optimization** — Rothrock's finding that agents revise poorly (31% recovery rate) is an agent system concern, not a definition layer concern
- **Process reward models** — the training-time application of gate topology is outside OpenTeams' scope

---

## 11. References

- Rothrock, M. (2025–2026). [Trust Topology](https://michael.roth.rocks/). The framework this design draws from.
- Rothrock, M. (2025–2026). [543 Hours of Autonomous AI](https://michael.roth.rocks/research/543-hours/). Workflow methodology and operational patterns.
- Rothrock, M. (2026). [Gate Analysis](https://michael.roth.rocks/research/gate-analysis/). Empirical data on error taxonomy and gate specificity.
- Brown, B., et al. (2024). "Large Language Monkeys: Scaling Inference Compute with Repeated Sampling."
- Snell, C., et al. (2024). "Scaling LLM Test-Time Compute Optimally Can Be More Effective Than Scaling Model Parameters."
- Lu, J., et al. (2025). "When Does Verification Pay Off?" arXiv:2512.02304.
