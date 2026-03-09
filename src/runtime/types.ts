// ─────────────────────────────────────────────────────────────
// Runtime State Observation Types
// ─────────────────────────────────────────────────────────────
// Types for tracking team member identity, status, and
// communication validation at runtime. These align with MAP
// protocol primitives but are protocol-agnostic.

// --- Identity ---

/** Opaque runtime identifier for an agent (session ID, MAP agent ID, etc.). */
export type AgentIdentifier = string;

/** Resolved identity of a team member. */
export interface MemberIdentity {
  /** Role name from the team template (e.g. "architect", "executor"). */
  role: string;
  /** Human-readable label, unique within the team (e.g. "executor-1"). */
  label: string;
  /** Runtime-specific agent identifier. */
  agentId: AgentIdentifier;
}

// --- Status ---

/** High-level member lifecycle status. */
export type MemberStatus =
  | "registered"
  | "idle"
  | "busy"
  | "stopped"
  | "error";

/** Fine-grained execution status (optional, runtime-specific). */
export type ExecutionStatus =
  | "spawning"
  | "prompting"
  | "tool_use"
  | "waiting"
  | "completed"
  | "cancelled"
  | "errored";

/** Full state of a team member at a point in time. */
export interface MemberState {
  identity: MemberIdentity;
  status: MemberStatus;
  executionStatus?: ExecutionStatus;
  lastActivity: number; // epoch ms
  error?: string;
  metadata?: Record<string, unknown>;
}

// --- Events ---

export interface AgentRegisteredEvent {
  type: "agent_registered";
  role: string;
  label: string;
  agentId: AgentIdentifier;
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

export interface AgentUnregisteredEvent {
  type: "agent_unregistered";
  agentId: AgentIdentifier;
  reason?: string;
  timestamp?: number;
}

export interface AgentStateChangedEvent {
  type: "agent_state_changed";
  agentId: AgentIdentifier;
  status: MemberStatus;
  executionStatus?: ExecutionStatus;
  error?: string;
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

/** Discriminated union of all team events. */
export type TeamEvent =
  | AgentRegisteredEvent
  | AgentUnregisteredEvent
  | AgentStateChangedEvent;

/** Emitted by onStateChange listeners. Includes previous state for diffing. */
export interface StateChangeEvent {
  event: TeamEvent;
  member: MemberState;
  previous?: MemberState;
}

// --- Validation ---

export type ViolationSeverity = "error" | "warning" | "info";

export interface Violation {
  message: string;
  severity: ViolationSeverity;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

// --- Snapshots ---

export interface TeamStateSnapshot {
  teamName: string;
  timestamp: number;
  members: MemberState[];
  /** Summary of active roles and their instance counts. */
  roleCounts: Record<string, number>;
}

// --- Listener ---

export type StateChangeListener = (event: StateChangeEvent) => void;
