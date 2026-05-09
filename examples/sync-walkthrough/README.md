# Sync Walkthrough

Runnable end-to-end demo of the OpenTeams sync surface against the
`loadout-demo` template.

## Run

From the repo root:

```bash
npx tsx examples/sync-walkthrough/walkthrough.ts
```

## What it shows

1. **Load + bundle** — `TemplateLoader.load` → `bundleTeam` and `bundleLoadout`.
2. **Embedded == standalone** — every loadout's id inside the team bundle
   matches what `bundleLoadout` produces standalone. This is what makes
   loadouts addressable independently across teams.
3. **Wire transfer** — `JSON.stringify` → `JSON.parse`. Bundle resources are
   plain JSON; nothing in the format requires anything beyond a JSON-capable
   transport.
4. **Validate + hydrate on the consumer side** — `validateTeamBundle` reports
   any issues; `hydrateBundle` reproduces a `ResolvedTemplate` equivalent to
   the original. A leaf agent that only needs a single loadout takes the
   shorter `hydrateLoadout` path.
5. **Spawn dispatch** — `encodeSpawnTaskMeta` / `decodeSpawnTaskMeta` with a
   round-trip through JSON, mirroring how a MAP task carries the request
   between orchestrator and worker.
6. **Tampering detection** — modifying a bundle after JSON parse triggers
   both a non-throwing `validate*Bundle` error violation and a thrown
   `hydrate*` error. Hashes are content-derived, so tampering is detectable
   without a separate signature.

## In a real consumer project

The walkthrough imports from relative paths because it lives inside the
OpenTeams repo. In a published consumer:

```typescript
import {
  bundleTeam,
  hydrateBundle,
  encodeSpawnTaskMeta,
  validateTeamBundle,
  loadoutRef,
  teamRef,
} from "openteams";
```

For wiring kind handlers into a MAP server, see `docs/map-integration.md`.
