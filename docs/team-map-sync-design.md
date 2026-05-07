# Teams as MAP-Syncable Resources — Design Exploration

> Status: **Exploration** — not a spec, not committed to. This document sketches what it could look like to publish OpenTeams team templates as first-class, syncable resources over MAP (or any peer protocol with similar semantics).

## The Problem

Today, a `ResolvedTemplate` lives on disk in the agent system that loaded it. The runtime layer (`src/runtime/`) emits MAP-aligned events about *members* — `agent_registered`, `agent_state_changed`, `agent_unregistered` — but the **team definition itself is invisible to peers**. Two consequences:

1. **No shared vocabulary.** When Agent A says "I am `executor-2`," Agent B has no protocol-level way to know what role `executor` is, what channels it subscribes to, or what loadout it carries — unless both sides happen to have loaded the same template out-of-band.
2. **No discovery.** An agent that wants to participate in a federation, or a UI that wants to render an unfamiliar team, must obtain the template through a side channel (git clone, scp, manual install).

Member events are meaningful only against a known team manifest. Publishing the manifest itself closes that loop.

## Design Principles

1. **Definition stays definitional.** The synced artifact is a *resolved, immutable manifest snapshot* — not live editable state. Edits happen in files via the CLI, then a new snapshot is published.
2. **Content-addressed.** A team is identified by the hash of its resolved bundle. Names and versions are resolvable aliases that point at hashes.
3. **Bundle granularity.** A published team is one self-contained blob (manifest + roles + loadouts + prompts + skill MD). No partial loads. This matches how `TemplateLoader` already works and avoids re-running inheritance resolution on the consumer.
4. **Reuses `generatePackage()`.** The bundle shape already exists — we're giving it an identity, a transport, and a sync verb.
5. **MAP carries references, not bytes (mostly).** MAP control messages reference teams by URI; the bytes can travel over MAP or any out-of-band fetch the consumer prefers.

## The Resource: `TeamBundle`

A `TeamBundle` is the unit of publication. It's a serialized form of `ResolvedTemplate` plus everything needed to reproduce its prompts and skills without further filesystem access.

```typescript
interface TeamBundle {
  /** Schema version of this bundle envelope (not the team's version). */
  bundleVersion: 1;

  /** Canonical content hash of the bundle (sha256 of the canonicalized payload). */
  hash: string;

  /** Authoring identity — name + semver, both author-controlled. */
  name: string;
  version: string;

  /** Resolved manifest, after role + loadout inheritance. */
  manifest: ResolvedTemplate["manifest"];
  roles: Record<string, ResolvedRole>;
  loadouts: Record<string, ResolvedLoadout>;

  /** Inline content for everything the bundle references. */
  prompts: Record<string, string>;        // path → markdown body
  skillCatalog: string;                   // generated skill catalog MD
  rolePrompts: Record<string, string>;    // role name → ROLE.md body

  /** Optional metadata. */
  publishedAt?: string;                   // ISO-8601
  publisher?: { id: string; signature?: string };
  description?: string;
}
```

### Identity: hash + alias

```
team:sha256:9f3a…              # canonical, immutable
team:gsd@1.4.0                 # alias — resolves to a hash
team:gsd@latest                # mutable alias — resolves to a hash
```

- The **hash** is the source of truth. Two bundles with the same hash are the same team, byte-for-byte.
- **Name+version aliases** are convenience pointers maintained by the publisher (or a registry). They can move; hashes can't.
- Member events should reference the hash (or both): `{ type: "agent_registered", team: "team:sha256:9f3a…", role: "executor", … }` so consumers can validate the event against the exact manifest the publisher used.

### Canonicalization (so hashes match across publishers)

The hash is over a canonical JSON serialization:
- Sorted object keys.
- Normalized line endings (LF) and trimmed trailing whitespace in prompt bodies.
- Stable iteration order for `roles`, `loadouts`, `prompts`.
- The `hash`, `publishedAt`, `publisher`, and `description` fields are excluded from the hash input.

Implementation lives next to `generatePackage()` — call it `bundleTeam(template, options): TeamBundle`.

## The Sync Verbs

Three control-plane operations, all carryable on MAP as message types:

### `team_published`

The publisher announces a new bundle. Peers can pull the bytes if they don't have the hash.

```json
{
  "type": "team_published",
  "team": { "name": "gsd", "version": "1.4.0", "hash": "sha256:9f3a…" },
  "publisher": "did:example:alex",
  "publishedAt": "2026-05-07T10:00:00Z",
  "fetch": [
    { "transport": "map", "channel": "team-bundles" },
    { "transport": "https", "url": "https://teams.example.com/sha256/9f3a…" }
  ]
}
```

### `team_referenced`

A participant declares which team(s) it is currently operating under. Sent at session start and whenever the active team changes. This is what makes member events interpretable.

```json
{
  "type": "team_referenced",
  "agentId": "gsd-architect",
  "team": "team:sha256:9f3a…",
  "role": "architect"
}
```

### `team_request` / `team_response`

Pull verb. A peer that sees a hash it doesn't have can request the bundle.

```json
{ "type": "team_request", "hash": "sha256:9f3a…" }
{ "type": "team_response", "hash": "sha256:9f3a…", "bundle": { /* TeamBundle */ } }
```

That's the whole protocol surface for v1. Everything else (caching, retention, eviction) is consumer-local policy.

## Relationship to Existing Runtime

`src/runtime/team-state.ts` already consumes a `ResolvedTemplate` to validate member events. The sync layer adds one step in front:

```
peer publishes → consumer fetches bundle → consumer hydrates ResolvedTemplate
                                         → consumer constructs TeamState(template)
                                         → existing event validation works unchanged
```

Concretely:

```typescript
const bundle = await mapClient.fetchTeam("team:sha256:9f3a…");
const template = hydrateBundle(bundle);          // new: TeamBundle → ResolvedTemplate
const team = new TeamState(bundle.name, template);
mapClient.onMemberEvent((e) => team.applyEvent(e));
```

`hydrateBundle()` is the inverse of `bundleTeam()`. The `ResolvedTemplate` it produces is identical (modulo file paths) to one loaded from disk, so all existing generators and the runtime work unchanged.

## Trust and Validation

OpenTeams should not invent a PKI, but it should leave room for one:

- `publisher.signature` is opaque to OpenTeams. Consumers (or a registry layer above) decide whether to verify.
- The `hash` is verifiable without trust — recompute and compare.
- A consumer policy might be "accept any hash signed by `did:example:alex`" or "only accept hashes pre-registered in `~/.openteams/trusted.json`."

This belongs in a follow-up, not v1.

## What This Is *Not*

- **Not a registry.** OpenTeams stores and references bundles; it doesn't host them. A registry (think npm-for-teams) is a separate layer that maps aliases → hashes and serves bytes.
- **Not federation.** Federation (`docs/federated-teams-design.md`) is about composing multiple teams into one runtime topology. Sync is about distributing the *definition* of any single team. Federation will likely consume sync once both exist.
- **Not editable state.** Live edits to a published bundle are not a thing. Editing produces a new hash. Aliases can move, hashes cannot.
- **Not a replacement for `template install`.** `openteams template install <repo>` still works for git-based distribution. Sync is the peer-to-peer/runtime-discovery path; install is the developer-workflow path. They produce the same `ResolvedTemplate`.

## Proposed Module Layout

```
src/sync/
  bundle.ts          # bundleTeam(template, opts): TeamBundle
                     # hydrateBundle(bundle): ResolvedTemplate
                     # canonicalize() + hash()
  types.ts           # TeamBundle, TeamReference, sync message types
  uri.ts             # parse/format team:sha256:…  team:name@version
  bundle.test.ts     # round-trip: template → bundle → template (deep equal)
                     # canonicalization: same template, different machines, same hash
```

No transport code in `src/sync/` — MAP wiring lives in the consumer. OpenTeams ships the bundle format and the verbs; consumers ship the radio.

## Open Questions

1. **Prompt bodies inline vs. by-reference?** Inline (current sketch) keeps bundles self-contained at the cost of size. By-reference (each prompt is its own hash, bundle holds references) enables dedup across teams that share prompts — at the cost of multi-step fetch. Recommendation: inline for v1, revisit if bundles grow large.
2. **MCP server refs (`{ ref: "@org/foo" }`).** Bundles travel between machines whose MCP registries differ. Should `findMissingMcpReferences()` run at hydrate time and surface warnings? Probably yes — non-fatal, surfaces in `ValidationResult`.
3. **Extension namespaces** (`macro_agent:`, `gsd:`, etc.). They're carried verbatim today. Should the bundle format version them, or stay opaque? Stay opaque — that's the existing contract.
4. **Does `team_referenced` need a TTL or heartbeat?** Probably not — `agent_unregistered` already covers exit. But long-lived agents that switch teams need to re-publish; worth specifying the rule.
5. **Alias resolution.** Who resolves `team:gsd@1.4.0` → hash? An optional `team_alias_resolved` message? A registry? Out of scope for v1; aliases are publisher-asserted in `team_published` and consumers cache locally.

## Minimal v1 Scope

If we built only what's needed to make this useful end-to-end:

1. `bundleTeam()` + `hydrateBundle()` + canonical hash, with a round-trip test.
2. `TeamBundle` and the three message types in `src/sync/types.ts`, exported from `src/index.ts`.
3. CLI: `openteams bundle <template-dir>` → writes `<hash>.teambundle.json` to stdout or a file.
4. Documentation and one worked example using the `gsd` template.

Everything else — registries, signatures, partial loads, MAP transport itself — stays out until a consumer needs it.
