import type { ResolvedTemplate } from "../template/types";
import type {
  TeamEvent,
  MemberState,
  MemberStatus,
  StateChangeEvent,
  StateChangeListener,
  TeamStateSnapshot,
  ValidationResult,
} from "./types";
import { MemberRegistry } from "./member-registry";
import { validateMessage } from "./validation";

/** Valid status transitions. Key = current status, value = allowed next statuses. */
const VALID_TRANSITIONS: Record<MemberStatus, Set<MemberStatus>> = {
  registered: new Set(["idle", "busy", "stopped", "error"]),
  idle: new Set(["busy", "stopped", "error"]),
  busy: new Set(["idle", "stopped", "error"]),
  stopped: new Set<MemberStatus>(), // terminal
  error: new Set(["registered", "stopped"]),
};

/**
 * Core state tracker for a running team.
 *
 * Accepts MAP-aligned events via `applyEvent()`, maintains member state,
 * and emits state change notifications. Delegates communication validation
 * to the stateless `validateMessage()` function.
 */
export class TeamState {
  readonly teamName: string;
  readonly registry: MemberRegistry;
  private readonly template: ResolvedTemplate;
  private readonly members = new Map<string, MemberState>(); // agentId → state
  private readonly listeners: Set<StateChangeListener> = new Set();

  constructor(teamName: string, template: ResolvedTemplate) {
    this.teamName = teamName;
    this.template = template;
    this.registry = new MemberRegistry(template);
  }

  /**
   * Process a team event and update internal state.
   *
   * @throws On invalid events (e.g. unknown agentId, invalid transition).
   */
  applyEvent(event: TeamEvent): void {
    const now = event.timestamp ?? Date.now();

    switch (event.type) {
      case "agent_registered": {
        const identity = this.registry.register(event.role, event.agentId, event.label);
        const state: MemberState = {
          identity,
          status: "registered",
          lastActivity: now,
          metadata: event.metadata,
        };
        this.members.set(event.agentId, state);
        this.emit({ event, member: state, previous: undefined });
        break;
      }

      case "agent_unregistered": {
        const previous = this.requireMember(event.agentId);
        this.registry.unregister(event.agentId);
        const updated: MemberState = {
          ...previous,
          status: "stopped",
          lastActivity: now,
        };
        this.members.delete(event.agentId);
        this.emit({ event, member: updated, previous });
        break;
      }

      case "agent_state_changed": {
        const previous = this.requireMember(event.agentId);
        this.validateTransition(previous.status, event.status, event.agentId);

        const updated: MemberState = {
          ...previous,
          status: event.status,
          executionStatus: event.executionStatus ?? previous.executionStatus,
          lastActivity: now,
          error: event.error ?? (event.status === "error" ? previous.error : undefined),
          metadata: event.metadata
            ? { ...previous.metadata, ...event.metadata }
            : previous.metadata,
        };
        this.members.set(event.agentId, updated);
        this.emit({ event, member: updated, previous });
        break;
      }
    }
  }

  /** Get a member's current state by agent ID. */
  getMember(agentId: string): MemberState | undefined {
    return this.members.get(agentId);
  }

  /** Get a member's state by label (resolves via registry). */
  getMemberByLabel(label: string): MemberState | undefined {
    const identity = this.registry.byLabel(label);
    if (!identity) return undefined;
    return this.members.get(identity.agentId);
  }

  /** Get all current member states. */
  getMembers(): MemberState[] {
    return [...this.members.values()];
  }

  /**
   * Validate a message between two members (by label).
   * Resolves labels to roles, then delegates to stateless validation.
   */
  validateMessageByLabel(
    fromLabel: string,
    toLabel: string,
    channel?: string,
    signal?: string
  ): ValidationResult {
    const from = this.registry.byLabel(fromLabel);
    const to = this.registry.byLabel(toLabel);
    if (!from) {
      return { valid: false, violations: [{ message: `Unknown sender label "${fromLabel}"`, severity: "error" }] };
    }
    if (!to) {
      return { valid: false, violations: [{ message: `Unknown receiver label "${toLabel}"`, severity: "error" }] };
    }
    return validateMessage(this.template, from.role, to.role, channel, signal);
  }

  /**
   * Subscribe to state changes.
   * @returns Unsubscribe function.
   */
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Produce a serializable snapshot of the current team state. */
  snapshot(): TeamStateSnapshot {
    const roleCounts: Record<string, number> = {};
    for (const state of this.members.values()) {
      const role = state.identity.role;
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
    return {
      teamName: this.teamName,
      timestamp: Date.now(),
      members: this.getMembers(),
      roleCounts,
    };
  }

  private requireMember(agentId: string): MemberState {
    const state = this.members.get(agentId);
    if (!state) {
      throw new Error(`No member with agent ID "${agentId}"`);
    }
    return state;
  }

  private validateTransition(from: MemberStatus, to: MemberStatus, agentId: string): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.has(to)) {
      throw new Error(
        `Invalid status transition "${from}" → "${to}" for agent "${agentId}"`
      );
    }
  }

  private emit(event: StateChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
