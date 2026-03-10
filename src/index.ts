export const VERSION = "0.2.0";

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
