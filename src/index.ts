export const VERSION = "0.3.0";

// Template types
export type {
  TeamManifest,
  TopologyConfig,
  SpawnRuleEntry,
  TopologyNode,
  TopologyNodeConfig,
  CommunicationConfig,
  ChannelDefinition,
  SubscriptionEntry,
  RoutingConfig,
  PeerRoute,
  ExportDeclaration,
  ImportDeclaration,
  PlacementConfig,
  RoleDefinition,
  CapabilityComposition,
  CapabilityMap,
  McpServerEntry,
  McpServerRef,
  McpServerScopeEntry,
  McpServerScopeOpts,
  NormalizedMcpScope,
  McpProviderSpec,
  LoadoutDefinition,
  ResolvedLoadout,
  SkillsConfig,
  PermissionsConfig,
  LoadOptions,
  AsyncLoadOptions,
  PromptSection,
  ResolvedPrompts,
  ResolvedTemplate,
  ResolvedRole,
  TemplateSource,
  TemplateInfo,
  OpenTeamsConfig,
  DefaultsConfig,
  FederationManifest,
  FederationTeamEntry,
  FederationBridge,
  ResolvedFederation,
} from "./template/types";

// Template loader
export { TemplateLoader, spawnRuleTarget, isCapabilityMap } from "./template/loader";

// Loadout merge utilities (for consumers implementing their own override layers)
export { mergeLoadout, resolveStandaloneLoadout, normalizeMcpEntries } from "./template/loadout-merge";

// Template install
export { TemplateInstallService } from "./template/install-service";
export type {
  InstallOptions,
  InstallResult,
  DiscoveredTemplate,
  InstallCallbacks,
} from "./template/install-service";

// Built-in templates
export {
  isTemplateName,
  getBuiltinTemplateDir,
  listBuiltinTemplates,
} from "./template/builtins";
export type { BuiltinTemplateInfo } from "./template/builtins";

// Template resolver (unified resolution)
export {
  resolveTemplateName,
  listAllTemplates,
  loadConfig,
  findConfigPath,
  findOpenTeamsDir,
  isBuiltinEnabled,
  writeConfig,
} from "./template/resolver";

// Generators
export { generateSkillMd, generateCatalog } from "./generators/skill-generator";
export type {
  SkillGeneratorOptions,
  CatalogOptions,
} from "./generators/skill-generator";
export {
  generateAgentPrompts,
  generateAgentPrompt,
  generateRoleSkillMd,
  generateAllRoleSkillMds,
} from "./generators/agent-prompt-generator";
export type {
  AgentPrompt,
  AgentPromptGeneratorOptions,
  RoleSkillMd,
  RoleSkillMdOptions,
} from "./generators/agent-prompt-generator";
export { generatePackage } from "./generators/package-generator";
export type {
  PackageGeneratorOptions,
  PackageResult,
} from "./generators/package-generator";

// Loadout generator — artifacts, effective-loadout lookup, YAML rendering, consumer index
export {
  generateLoadoutArtifacts,
  getEffectiveLoadout,
  renderLoadoutYaml,
  listLoadoutConsumers,
  listInlineLoadoutRoles,
  findMissingMcpReferences,
  getMcpProviders,
} from "./generators/loadout-generator";
export type { LoadoutArtifacts } from "./generators/loadout-generator";

// Federation
export { loadFederation, composeFederation } from "./template/federation-loader";
export { FederationState } from "./runtime/federation-state";
export type {
  FederationSnapshot,
  FederationStateChangeEvent,
  FederationStateChangeListener,
} from "./runtime/federation-state";
export { generateFederatedSkillMd, generateBridgeContext } from "./generators/federation-generator";
export type { FederationSkillOptions } from "./generators/federation-generator";

// Runtime state observation
export { MemberRegistry } from "./runtime/member-registry";
export { TeamState } from "./runtime/team-state";
export { validateMessage, validateBridgeMessage } from "./runtime/validation";
export type {
  AgentIdentifier,
  MemberIdentity,
  MemberStatus,
  ExecutionStatus,
  MemberState,
  TeamEvent,
  AgentRegisteredEvent,
  AgentUnregisteredEvent,
  AgentStateChangedEvent,
  StateChangeEvent,
  StateChangeListener,
  ValidationResult,
  Violation,
  ViolationSeverity,
  TeamStateSnapshot,
} from "./runtime/types";
