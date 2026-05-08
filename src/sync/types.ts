// ─────────────────────────────────────────────────────────────
// MAP Resource Protocol — Bundle Types
// ─────────────────────────────────────────────────────────────
// Local copies of the MAP Resource Protocol v1 envelope and the
// OpenTeams-specific resource shapes. These match the spec in
// multi-agent-protocol/docs/13-resource-protocol.md. When the
// MAP SDK ships these types, this module can re-export them.
//
// See docs/team-map-sync-design.md for the design and
// docs/map-integration.md for the wiring path.

import type {
  McpProviderSpec,
  McpServerEntry,
  ResolvedLoadout,
  ResolvedPrompts,
  ResolvedRole,
  TeamManifest,
} from "../template/types";

// ─────────────────────────────────────────────────────────────
// MAP Resource envelope (matches Resource Protocol v1)
// ─────────────────────────────────────────────────────────────

/**
 * Standard envelope for any typed resource on the wire. Mirrors
 * `MAPResource` in the Resource Protocol v1 spec. Generic over the
 * `metadata` shape so kind-specific resource types can constrain it.
 */
export interface MAPResource<TMeta = Record<string, unknown>> {
  /** Kind-defined unique id. For x-openteams/* kinds this is the content hash. */
  id: string;
  /** Namespaced type, e.g. "x-openteams/loadout". */
  type: string;
  /** Human-readable display name. */
  name: string;
  /** Lifecycle status. Values are kind-defined. */
  status: string;
  /** Owning agent/user id. */
  owner_id: string;
  /** null for locally-created; the originating hub id for federated resources. */
  origin_hub_id: string | null;
  /** ISO-8601 creation timestamp. */
  created_at: string;
  /** ISO-8601 last-modification timestamp. */
  updated_at: string;
  /** Kind-specific payload. Opaque to the protocol. */
  metadata: TMeta;
}

// ─────────────────────────────────────────────────────────────
// Loadout resource (x-openteams/loadout)
// ─────────────────────────────────────────────────────────────

/** Bundle envelope schema version — bump when the metadata shape changes. */
export type BundleVersion = 1;

/** Publisher identity attached to a bundle. Opaque to OpenTeams. */
export interface BundlePublisher {
  id: string;
  signature?: string;
}

/**
 * Metadata payload for an x-openteams/loadout resource.
 * Identity-bearing fields (bundleVersion, version, resolved) feed the
 * content hash. Descriptive fields (publisher, description, tags) do not.
 */
export interface LoadoutResourceMetadata {
  bundleVersion: BundleVersion;
  /** Author-controlled semantic version. */
  version: string;
  /** Resolved loadout — the canonical content of this bundle. */
  resolved: ResolvedLoadout;
  /** Optional descriptive fields — excluded from the content hash. */
  publisher?: BundlePublisher;
  description?: string;
  tags?: string[];
}

/** A MAPResource of type "x-openteams/loadout". */
export interface LoadoutResource extends MAPResource<LoadoutResourceMetadata> {
  type: "x-openteams/loadout";
}

// ─────────────────────────────────────────────────────────────
// Team resource (x-openteams/team)
// ─────────────────────────────────────────────────────────────

/**
 * A loadout embedded inside a team bundle. The `id` is the standalone
 * loadout hash (matches the result of `bundleLoadout(resolved).id`),
 * which lets a coordinator address the same loadout independently of
 * the team it was discovered in.
 */
export interface EmbeddedLoadout {
  /** Standalone loadout content hash. */
  id: string;
  /** Resolved loadout content. */
  resolved: ResolvedLoadout;
}

/**
 * Metadata payload for an x-openteams/team resource.
 *
 * Hash inputs: `bundleVersion`, `type`, `name`, `manifest`, `roles`,
 * loadout id refs (not full content), `prompts`, `mcpServers`.
 *
 * Excluded from hash: `version`, `publisher`, `description`, `tags`.
 *
 * `mcpProviders` is not stored separately — it is reconstructed from
 * `manifest.mcp_providers` at hydrate time.
 */
export interface TeamResourceMetadata {
  bundleVersion: BundleVersion;
  /** Author-controlled semver label. Excluded from hash. */
  version: string;
  manifest: TeamManifest;
  roles: Record<string, ResolvedRole>;
  loadouts: Record<string, EmbeddedLoadout>;
  prompts: Record<string, ResolvedPrompts>;
  /** Legacy role-level MCP server entries (from roles/<name>.yaml). */
  mcpServers: Record<string, McpServerEntry[]>;
  publisher?: BundlePublisher;
  description?: string;
  tags?: string[];
}

/** A MAPResource of type "x-openteams/team". */
export interface TeamResource extends MAPResource<TeamResourceMetadata> {
  type: "x-openteams/team";
}

// ─────────────────────────────────────────────────────────────
// Bundling options
// ─────────────────────────────────────────────────────────────

export interface BundleLoadoutOptions {
  /** Author-controlled semver label. Excluded from hash. */
  version: string;
  /** Defaults to `resolved.name`. */
  name?: string;
  /** Owning agent/user id. Defaults to empty string. */
  ownerId?: string;
  /** Optional descriptive metadata — excluded from hash. */
  description?: string;
  tags?: string[];
  publisher?: BundlePublisher;
  /** ISO-8601 timestamp for `created_at`/`updated_at`. Defaults to now. Excluded from hash. */
  timestamp?: string;
}

export interface BundleTeamOptions {
  /** Author-controlled semver label. Excluded from hash. */
  version: string;
  /** Defaults to `template.manifest.name`. */
  name?: string;
  /** Owning agent/user id. Defaults to empty string. */
  ownerId?: string;
  /** Optional descriptive metadata — excluded from hash. */
  description?: string;
  tags?: string[];
  publisher?: BundlePublisher;
  /** ISO-8601 timestamp. Defaults to now. Excluded from hash. */
  timestamp?: string;
}

// ─────────────────────────────────────────────────────────────
// Resource type constants
// ─────────────────────────────────────────────────────────────

export const LOADOUT_RESOURCE_TYPE = "x-openteams/loadout" as const;
export const TEAM_RESOURCE_TYPE = "x-openteams/team" as const;

export type OpenTeamsResourceType =
  | typeof LOADOUT_RESOURCE_TYPE
  | typeof TEAM_RESOURCE_TYPE;

// ─────────────────────────────────────────────────────────────
// Resource reference (parsed URI-like string)
// ─────────────────────────────────────────────────────────────

/**
 * Parsed form of a resource reference such as
 * `x-openteams/loadout:sha256:abc…` or `x-openteams/team:gsd@1.4.0`.
 *
 * The string form is `<type>:<id>` where `<type>` is the namespaced
 * MAP resource type and `<id>` is the kind-defined identifier
 * (content hash or `<name>@<version>` alias).
 */
export interface ResourceRef {
  type: OpenTeamsResourceType;
  id: string;
}

// ─────────────────────────────────────────────────────────────
// Spawn dispatch (MAP task meta payload)
// ─────────────────────────────────────────────────────────────

/** Discriminator value for spawn-dispatch tasks. */
export const SPAWN_KIND = "openteams.spawn" as const;

export interface SpawnTarget {
  /** Target runtime, e.g. "claude-code", "gemini". */
  runtime?: string;
  /** Logical placement hints. Opaque to OpenTeams. */
  placement?: Record<string, unknown>;
  /** Extension namespaces — consumers may attach runtime-specific fields. */
  [key: string]: unknown;
}

/**
 * Application-level spawn request shape used by orchestrators and
 * worker pools. Travels on the wire as `MAPTask.meta` after passing
 * through `encodeSpawnTaskMeta`.
 */
export interface SpawnRequest {
  /** Loadout reference, stringified (e.g. `x-openteams/loadout:sha256:…`). */
  loadout: string;
  /** Optional label for the spawned agent. */
  label?: string;
  /** Optional team reference, stringified. Present in team-context spawns. */
  team?: string;
  /** Optional role name from the team. */
  role?: string;
  /** Target runtime + placement hints. */
  target?: SpawnTarget;
  /** Spawning agent's MAP id. */
  parent?: string;
}

/** Wire form of `SpawnRequest` carried in `MAPTask.meta`. */
export interface SpawnTaskMeta {
  kind: typeof SPAWN_KIND;
  loadout: string;
  label?: string;
  team?: string;
  role?: string;
  target?: SpawnTarget;
  parent?: string;
  /** Set on completion: the spawned agent's id. */
  agentId?: string;
}

/** Outcome of a spawn task. */
export interface SpawnResult {
  /** The MAP task id. */
  taskId: string;
  /** Final task status (e.g. "completed", "failed"). */
  status: string;
  /** The spawned agent's id, set on successful completion. */
  agentId?: string;
}

// ─────────────────────────────────────────────────────────────
// Agent registration metadata
// ─────────────────────────────────────────────────────────────

/**
 * Fields an OpenTeams-aware agent attaches to its MAP `Participant.metadata`
 * at registration. `loadout` is required; the rest are optional team-context
 * hints that coordinators may use for membership reconstruction.
 */
export interface AgentMetadata {
  /** Loadout reference, stringified. */
  loadout: string;
  /** Role name from the team. */
  role?: string;
  /** Team reference, stringified. */
  team?: string;
  /** Spawning agent's id. */
  parent?: string;
  /** Extension namespaces — consumers may attach runtime-specific fields. */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Bundle lifecycle events (per MAP Resource Protocol §Events)
// ─────────────────────────────────────────────────────────────

export type BundleEventType =
  | "resource.added"
  | "resource.updated"
  | "resource.removed";

/**
 * Lifecycle event payload for an OpenTeams resource. Conforms to the
 * `ResourceEvent` shape in the MAP Resource Protocol spec, constrained
 * to OpenTeams resource types.
 */
export interface BundleEvent {
  type: BundleEventType;
  resource_type: OpenTeamsResourceType;
  resource_id: string;
  resource_name: string;
  origin_hub_id: string | null;
  timestamp: string;
}
