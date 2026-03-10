import type { ResolvedFederation, FederationBridge } from "../template/types";
import type {
  TeamEvent,
  ValidationResult,
  StateChangeEvent,
  TeamStateSnapshot,
} from "./types";
import { TeamState } from "./team-state";
import { validateBridgeMessage } from "./validation";

// ─── Federation-specific types ───────────────────────────────

/** Snapshot of the entire federation at a point in time. */
export interface FederationSnapshot {
  name: string;
  timestamp: number;
  teams: Record<string, TeamStateSnapshot>;
}

/** Emitted when a state change occurs in any team within the federation. */
export interface FederationStateChangeEvent {
  teamKey: string;
  event: StateChangeEvent;
}

export type FederationStateChangeListener = (
  event: FederationStateChangeEvent
) => void;

/**
 * Tracks runtime state across multiple federated teams.
 *
 * Not an orchestrator — does not decide when to route signals.
 * Provides:
 * - One TeamState per team for identity/status tracking
 * - Bridge message validation against declared topology
 * - Unified snapshots for observability
 * - Cross-team state change notifications
 */
export class FederationState {
  readonly name: string;
  private readonly federation: ResolvedFederation;
  private readonly teams = new Map<string, TeamState>();
  private readonly listeners = new Set<FederationStateChangeListener>();

  constructor(federation: ResolvedFederation) {
    this.name = federation.manifest.name;
    this.federation = federation;

    for (const [key, template] of federation.teams) {
      const team = new TeamState(key, template);
      // Wire up per-team listeners to federation-level notifications
      team.onStateChange((event) => {
        this.emit({ teamKey: key, event });
      });
      this.teams.set(key, team);
    }
  }

  /** Get a team's state tracker by key. */
  getTeam(teamKey: string): TeamState | undefined {
    return this.teams.get(teamKey);
  }

  /** Get all team keys. */
  getTeamKeys(): string[] {
    return [...this.teams.keys()];
  }

  /** Apply an event to a specific team. */
  applyEvent(teamKey: string, event: TeamEvent): void {
    const team = this.teams.get(teamKey);
    if (!team) {
      throw new Error(`Unknown team "${teamKey}" in federation "${this.name}"`);
    }
    team.applyEvent(event);
  }

  /**
   * Validate a cross-team bridge message.
   *
   * Checks whether the federation defines a bridge for the given
   * source team/signal → destination team/channel path.
   */
  validateBridgeMessage(
    fromTeam: string,
    signal: string,
    toTeam: string,
    channel: string
  ): ValidationResult {
    return validateBridgeMessage(
      this.federation.bridges,
      fromTeam,
      signal,
      toTeam,
      channel,
      this.federation.manifest.enforcement
    );
  }

  /**
   * Get the bridges that originate from a specific team.
   * Useful for agent systems to know which signals to forward.
   */
  getBridgesFrom(teamKey: string): FederationBridge[] {
    return this.federation.bridges.filter((b) => b.from.team === teamKey);
  }

  /**
   * Get the bridges that target a specific team.
   * Useful for agent systems to know which signals to expect.
   */
  getBridgesTo(teamKey: string): FederationBridge[] {
    return this.federation.bridges.filter((b) => b.to.team === teamKey);
  }

  /** Subscribe to state changes across all teams. */
  onStateChange(listener: FederationStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Produce a serializable snapshot of the entire federation. */
  snapshot(): FederationSnapshot {
    const teamSnapshots: Record<string, TeamStateSnapshot> = {};
    for (const [key, team] of this.teams) {
      teamSnapshots[key] = team.snapshot();
    }
    return {
      name: this.name,
      timestamp: Date.now(),
      teams: teamSnapshots,
    };
  }

  private emit(event: FederationStateChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
