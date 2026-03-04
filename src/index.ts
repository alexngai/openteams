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
