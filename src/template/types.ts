// ─────────────────────────────────────────────────────────────
// Team Template Types
// ─────────────────────────────────────────────────────────────
// These mirror the macro-agent team template schema.
// Generic multi-agent fields are top-level; system-specific
// extensions live under namespaced keys (e.g. macro_agent).

// --- Manifest (team.yaml) ---

export interface TeamManifest {
  name: string;
  description?: string;
  version: number;
  roles: string[];
  topology: TopologyConfig;
  communication?: CommunicationConfig;

  // Extension fields from other systems — stored but not interpreted
  macro_agent?: Record<string, unknown>;
  [key: string]: unknown;
}

// --- Topology ---

/**
 * A spawn rule entry: either a plain role name (string) or an object
 * with a role name and optional max_instances constraint.
 */
export type SpawnRuleEntry = string | { role: string; max_instances?: number };

export interface TopologyConfig {
  root: TopologyNode;
  companions?: TopologyNode[];
  spawn_rules?: Record<string, SpawnRuleEntry[]>;
}

export interface TopologyNode {
  role: string;
  prompt?: string; // path to prompt file relative to template dir
  config?: TopologyNodeConfig;
}

export interface TopologyNodeConfig {
  model?: string;
  placement?: PlacementConfig;
  [key: string]: unknown;
}

/** Logical placement hints for agent systems. OpenTeams stores but does not interpret. */
export interface PlacementConfig {
  zone?: string;
  affinity?: string[];
  replicas?: number;
  constraints?: Record<string, unknown>;
}

// --- Communication ---

export interface CommunicationConfig {
  enforcement?: "strict" | "permissive" | "audit";
  channels?: Record<string, ChannelDefinition>;
  subscriptions?: Record<string, SubscriptionEntry[]>;
  emissions?: Record<string, string[]>;
  routing?: RoutingConfig;

  /** Signals this team makes available to other teams via federation bridges. */
  exports?: ExportDeclaration[];
  /** Channels that receive signals from external teams via federation bridges. */
  imports?: ImportDeclaration[];
}

/** A signal this team exports for consumption by other federated teams. */
export interface ExportDeclaration {
  signal: string;
  description?: string;
}

/** A channel that receives signals from external federated teams. */
export interface ImportDeclaration {
  channel: string;
  signals: string[];
  description?: string;
}

export interface ChannelDefinition {
  description?: string;
  signals: string[];
}

export interface SubscriptionEntry {
  channel: string;
  signals?: string[]; // if omitted, subscribes to all signals in channel
}

export interface RoutingConfig {
  status?: "upstream" | "none";
  peers?: PeerRoute[];
}

export interface PeerRoute {
  from: string;
  to: string;
  via: "direct" | "topic" | "scope";
  signals?: string[];
}

// --- Role Definition (roles/<name>.yaml) ---

export interface RoleDefinition {
  name: string;
  extends?: string;
  display_name?: string;
  description?: string;
  capabilities?: string[] | CapabilityComposition | CapabilityMap;
  prompt?: string; // path to a single prompt file
  prompts?: string[]; // ordered list of prompt files (relative to prompts/<role>/)

  // Flat capability composition (alternative to CapabilityComposition inside capabilities).
  // Only valid when `extends` is set. Mutually exclusive with CapabilityComposition in `capabilities`.
  capabilities_add?: string[];
  capabilities_remove?: string[];

  // Extension fields
  macro_agent?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CapabilityComposition {
  add?: string[];
  remove?: string[];
}

/**
 * Map form for capabilities: keys are dot-namespaced capability tokens,
 * values are opaque config objects (or null for no config).
 *
 * Example:
 *   capabilities:
 *     file.read: null
 *     lifecycle.ephemeral: { max_duration: 3600 }
 */
export type CapabilityMap = Record<string, Record<string, unknown> | null>;

// --- Prompt Sections ---

export interface PromptSection {
  /** Filename stem, e.g. "soul", "guidelines", "prompt" */
  name: string;
  /** Markdown content of this section */
  content: string;
}

export interface ResolvedPrompts {
  /** The primary prompt content (from prompt.md or the single-file prompt) */
  primary: string;
  /** Additional prompt materials, in load order */
  additional: PromptSection[];
}

// --- Resolved Template (fully loaded) ---

export interface ResolvedTemplate {
  manifest: TeamManifest;
  roles: Map<string, ResolvedRole>;
  prompts: Map<string, ResolvedPrompts>; // role name → structured prompts
  mcpServers: Map<string, McpServerEntry[]>; // role name → MCP server entries
  sourcePath: string;
}

export interface ResolvedRole {
  name: string;
  extends?: string;
  displayName: string;
  description: string;
  capabilities: string[];
  capabilityConfig?: CapabilityMap;
  promptFile?: string;
  promptFiles?: string[]; // explicit ordering from role YAML
  raw: RoleDefinition; // original YAML for extension fields
}

// --- MCP Server Config ---

export interface McpServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// --- Load Options ---

/**
 * Options for TemplateLoader.load() — all hooks are synchronous.
 */
export interface LoadOptions {
  /** Resolve a role that `extends` a name not found in the local roles map. */
  resolveExternalRole?: (name: string) => ResolvedRole | null;
  /** Post-process each role after inheritance resolution. */
  postProcessRole?: (role: ResolvedRole, manifest: TeamManifest) => ResolvedRole;
  /** Post-process the entire template after loading. */
  postProcess?: (template: ResolvedTemplate) => ResolvedTemplate;
}

/**
 * Options for TemplateLoader.loadAsync() — hooks may return Promises.
 */
export interface AsyncLoadOptions {
  /** Resolve a role that `extends` a name not found in the local roles map. */
  resolveExternalRole?: (name: string) => Promise<ResolvedRole | null> | ResolvedRole | null;
  /** Post-process each role after inheritance resolution. */
  postProcessRole?: (role: ResolvedRole, manifest: TeamManifest) => Promise<ResolvedRole> | ResolvedRole;
  /** Post-process the entire template after loading. */
  postProcess?: (template: ResolvedTemplate) => Promise<ResolvedTemplate> | ResolvedTemplate;
}

// ─────────────────────────────────────────────────────────────
// Template Resolution & Configuration
// ─────────────────────────────────────────────────────────────

/** Source origin of a template. */
export type TemplateSource = "built-in" | "installed" | "installed (global)";

/** Unified info about any available template, regardless of source. */
export interface TemplateInfo {
  /** Directory name / logical template name */
  name: string;
  /** The manifest name from team.yaml */
  manifestName: string;
  /** Short description from team.yaml */
  description: string;
  /** Absolute path to the template directory */
  path: string;
  /** Where this template comes from */
  source: TemplateSource;
  /** If this template is shadowed by a higher-priority source */
  shadows?: TemplateSource;
}

/** Project-level OpenTeams configuration (.openteams/config.json). */
export interface OpenTeamsConfig {
  defaults?: DefaultsConfig;
}

/**
 * Controls which built-in templates are active.
 * - If absent: all built-ins available.
 * - If `include` is set: only those built-ins are active.
 * - If `exclude` is set: all built-ins except those are active.
 * - `include` and `exclude` are mutually exclusive.
 */
export interface DefaultsConfig {
  include?: string[];
  exclude?: string[];
}

// ─────────────────────────────────────────────────────────────
// Federation Types
// ─────────────────────────────────────────────────────────────
// Federation composes multiple standalone teams into a
// coordinated system via bridges (cross-team signal routing).

/** Raw federation manifest from federation.yaml. */
export interface FederationManifest {
  name: string;
  version: number;
  teams: Record<string, FederationTeamEntry>;
  bridges?: FederationBridge[];
  enforcement?: "strict" | "permissive" | "audit";
}

/** A team entry in a federation manifest. */
export interface FederationTeamEntry {
  /** Path to the team template directory, or an installed template name. */
  template: string;
  placement?: PlacementConfig;
}

/** A bridge routes signals from one team to another. */
export interface FederationBridge {
  from: { team: string; signal: string };
  to: { team: string; channel: string; signal: string };
}

/** A fully resolved federation — all templates loaded, bridges validated. */
export interface ResolvedFederation {
  manifest: FederationManifest;
  teams: Map<string, ResolvedTemplate>;
  bridges: FederationBridge[];
}

