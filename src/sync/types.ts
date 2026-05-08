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
