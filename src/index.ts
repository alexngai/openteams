export const VERSION = "0.1.0";

// Types
export type {
  Team,
  CreateTeamOptions,
  Member,
  MemberStatus,
  Task,
  TaskRow,
  TaskSummary,
  CreateTaskOptions,
  UpdateTaskOptions,
  TaskStatus,
  Message,
  MessageRow,
  MessageType,
  SendMessageOptions,
  BroadcastMessageOptions,
  ShutdownRequestOptions,
  ShutdownResponseOptions,
  PlanApprovalResponseOptions,
  AgentSpawner,
  AgentInstance,
  AgentUpdate,
  SpawnAgentOptions,
} from "./types";

// Template types
export type {
  TeamManifest,
  TopologyConfig,
  TopologyNode,
  TopologyNodeConfig,
  CommunicationConfig,
  ChannelDefinition,
  SubscriptionEntry,
  RoutingConfig,
  PeerRoute,
  RoleDefinition,
  CapabilityComposition,
  McpServerEntry,
  LoadOptions,
  AsyncLoadOptions,
  PromptSection,
  ResolvedPrompts,
  ResolvedTemplate,
  ResolvedRole,
  SignalEvent,
  EmitSignalOptions,
} from "./template/types";

// Database
export { createDatabase, createInMemoryDatabase } from "./db/database";

// Services
export { TeamService } from "./services/team-service";
export { TaskService } from "./services/task-service";
export { MessageService } from "./services/message-service";
export { AgentService } from "./services/agent-service";
export { TemplateService } from "./services/template-service";
export { CommunicationService } from "./services/communication-service";

// Template
export { TemplateLoader } from "./template/loader";

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

// Spawner
export { setSpawner, getSpawner, hasSpawner } from "./spawner/interface";
export { MockSpawner } from "./spawner/mock";

/**
 * Create an ACPFactorySpawner instance. Requires the optional `acp-factory` package.
 * @throws If `acp-factory` is not installed.
 */
export async function createACPFactorySpawner(): Promise<
  import("./types").AgentSpawner
> {
  const { ACPFactorySpawner } = await import("./spawner/acp-factory");
  return new ACPFactorySpawner();
}
