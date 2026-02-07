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
  CommunicationConfig,
  ChannelDefinition,
  SubscriptionEntry,
  RoutingConfig,
  PeerRoute,
  RoleDefinition,
  CapabilityComposition,
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
export { generateSkillMd } from "./generators/skill-generator";
export type { SkillGeneratorOptions } from "./generators/skill-generator";
export {
  generateAgentPrompts,
  generateAgentPrompt,
} from "./generators/agent-prompt-generator";
export type {
  AgentPrompt,
  AgentPromptGeneratorOptions,
} from "./generators/agent-prompt-generator";

// Spawner
export { setSpawner, getSpawner, hasSpawner } from "./spawner/interface";
export { ACPFactorySpawner } from "./spawner/acp-factory";
export { MockSpawner } from "./spawner/mock";
