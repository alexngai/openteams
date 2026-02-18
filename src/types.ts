// --- Team Types ---

export type EnforcementMode = "strict" | "permissive" | "audit";

export interface Team {
  name: string;
  description: string | null;
  agent_type: string | null;
  template_name: string | null;
  template_path: string | null;
  enforcement: EnforcementMode;
  group_name: string | null;
  created_at: string;
  status: "active" | "deleted";
}

export interface CreateTeamOptions {
  name: string;
  description?: string;
  agentType?: string;
  templateName?: string;
  templatePath?: string;
  groupName?: string;
}

// --- Team Group Types ---

export interface TeamGroup {
  name: string;
  description: string | null;
  created_at: string;
  status: "active" | "deleted";
}

export interface CreateTeamGroupOptions {
  name: string;
  description?: string;
}

export type BridgeMode = "forward" | "bidirectional";

export interface TeamBridge {
  id: number;
  group_name: string;
  source_team: string;
  target_team: string;
  source_channel: string;
  target_channel: string;
  signals: string[];
  mode: BridgeMode;
}

export interface TeamBridgeRow {
  id: number;
  group_name: string;
  source_team: string;
  target_team: string;
  source_channel: string;
  target_channel: string;
  signals: string;
  mode: BridgeMode;
}

export interface CreateTeamBridgeOptions {
  groupName: string;
  sourceTeam: string;
  targetTeam: string;
  sourceChannel: string;
  targetChannel: string;
  signals?: string[];
  mode?: BridgeMode;
}

// --- Member Types ---

export type MemberStatus = "idle" | "running" | "shutdown";

export interface Member {
  id: number;
  team_name: string;
  agent_name: string;
  agent_id: string | null;
  agent_type: string;
  role: string | null;
  status: MemberStatus;
  spawn_prompt: string | null;
  model: string | null;
  created_at: string;
}

// --- Task Types ---

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface Task {
  id: number;
  team_name: string;
  subject: string;
  description: string;
  active_form: string | null;
  status: TaskStatus;
  owner: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: number;
  team_name: string;
  subject: string;
  description: string;
  active_form: string | null;
  status: TaskStatus;
  owner: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskOptions {
  teamName: string;
  subject: string;
  description: string;
  activeForm?: string;
  blockedBy?: number[];
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskOptions {
  status?: TaskStatus;
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string | null;
  metadata?: Record<string, unknown>;
  addBlocks?: number[];
  addBlockedBy?: number[];
}

export interface TaskSummary {
  id: number;
  subject: string;
  status: TaskStatus;
  owner: string | null;
  blockedBy: number[];
}

// --- Message Types ---

export type MessageType =
  | "message"
  | "broadcast"
  | "shutdown_request"
  | "shutdown_response"
  | "plan_approval_response";

export interface Message {
  id: number;
  team_name: string;
  type: MessageType;
  sender: string;
  recipient: string | null;
  content: string;
  summary: string | null;
  request_id: string | null;
  approve: boolean | null;
  delivered: boolean;
  created_at: string;
}

export interface MessageRow {
  id: number;
  team_name: string;
  type: MessageType;
  sender: string;
  recipient: string | null;
  content: string;
  summary: string | null;
  request_id: string | null;
  approve: number | null;
  delivered: number;
  created_at: string;
}

export interface SendMessageOptions {
  teamName: string;
  sender: string;
  recipient: string;
  content: string;
  summary: string;
}

export interface BroadcastMessageOptions {
  teamName: string;
  sender: string;
  content: string;
  summary: string;
}

export interface ShutdownRequestOptions {
  teamName: string;
  sender: string;
  recipient: string;
  reason?: string;
}

export interface ShutdownResponseOptions {
  teamName: string;
  sender: string;
  requestId: string;
  approve: boolean;
  content?: string;
}

export interface PlanApprovalResponseOptions {
  teamName: string;
  sender: string;
  recipient: string;
  requestId: string;
  approve: boolean;
  content?: string;
}

// --- Agent Spawner Types ---

export interface SpawnAgentOptions {
  name: string;
  teamName: string;
  prompt: string;
  agentType?: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  permissionMode?: "auto-approve" | "auto-deny" | "interactive";
}

export interface AgentUpdate {
  type: "text" | "tool_call" | "thought" | "error" | "done";
  content: string;
}

export interface AgentInstance {
  id: string;
  name: string;
  isRunning(): boolean;
  sendPrompt(prompt: string): AsyncIterable<AgentUpdate>;
  shutdown(): Promise<void>;
}

export interface AgentSpawner {
  spawn(options: SpawnAgentOptions): Promise<AgentInstance>;
  shutdown(agentId: string): Promise<void>;
  list(): AgentInstance[];
}
