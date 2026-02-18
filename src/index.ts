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
  TeamGroup,
  CreateTeamGroupOptions,
  TeamBridge,
  TeamBridgeRow,
  CreateTeamBridgeOptions,
  BridgeMode,
} from "./types";

// Template types
export type {
  TeamManifest,
  TopologyConfig,
  TopologyNode,
  CommunicationConfig,
  ChannelDefinition,
  SubscriptionEntry,
  RoutingConfig,
  PeerRoute,
  RoleDefinition,
  CapabilityComposition,
  PromptSection,
  ResolvedPrompts,
  ResolvedTemplate,
  ResolvedRole,
  SignalEvent,
  EmitSignalOptions,
  GroupManifest,
  GroupTeamEntry,
  SharedAgentEntry,
  SharedAgentMembership,
  BridgeEntry,
  BridgeEndpoint,
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
export { TeamGroupService } from "./services/team-group-service";
export { GroupBootstrapService } from "./services/group-bootstrap-service";
export type { GroupBootstrapResult } from "./services/group-bootstrap-service";

// Template
export { TemplateLoader } from "./template/loader";
export { GroupLoader } from "./template/group-loader";
export type { ResolvedGroup } from "./template/group-loader";

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
