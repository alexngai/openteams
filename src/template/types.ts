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

export interface TopologyConfig {
  root: TopologyNode;
  companions?: TopologyNode[];
  spawn_rules?: Record<string, string[]>;
}

export interface TopologyNode {
  role: string;
  prompt?: string; // path to prompt file relative to template dir
  config?: TopologyNodeConfig;
}

export interface TopologyNodeConfig {
  model?: string;
  [key: string]: unknown;
}

// --- Communication ---

export interface CommunicationConfig {
  enforcement?: "strict" | "permissive" | "audit";
  channels?: Record<string, ChannelDefinition>;
  subscriptions?: Record<string, SubscriptionEntry[]>;
  emissions?: Record<string, string[]>;
  routing?: RoutingConfig;
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
  capabilities?: string[] | CapabilityComposition;
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

// --- Signal Event (emitted through channels) ---

export interface SignalEvent {
  id: number;
  team_name: string;
  channel: string;
  signal: string;
  sender: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SignalEventRow {
  id: number;
  team_name: string;
  channel: string;
  signal: string;
  sender: string;
  payload: string;
  created_at: string;
}

export interface EmitSignalOptions {
  teamName: string;
  channel: string;
  signal: string;
  sender: string;
  payload?: Record<string, unknown>;
}
