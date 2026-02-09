import type Database from "better-sqlite3";
import type { EnforcementMode } from "../types";
import type {
  CommunicationConfig,
  SignalEvent,
  SignalEventRow,
  EmitSignalOptions,
} from "../template/types";

export interface EmitResult {
  event: SignalEvent;
  permitted: boolean;
  enforcement: EnforcementMode;
}

export interface ChannelInfo {
  name: string;
  description: string | null;
  signals: string[];
}

export interface SubscriptionInfo {
  role: string;
  channel: string;
  signal: string | null;
}

export interface PeerRouteInfo {
  from_role: string;
  to_role: string;
  via: string;
  signals: string[];
}

export class CommunicationService {
  constructor(private db: Database.Database) {}

  /**
   * Apply a CommunicationConfig from a template manifest to a team.
   * Populates channels, signals, subscriptions, emissions, peer routes.
   */
  applyConfig(teamName: string, config: CommunicationConfig): void {
    // Store enforcement mode on the team
    if (config.enforcement) {
      this.db
        .prepare("UPDATE teams SET enforcement = ? WHERE name = ?")
        .run(config.enforcement, teamName);
    }

    // Channels + signals
    if (config.channels) {
      for (const [name, def] of Object.entries(config.channels)) {
        const result = this.db
          .prepare(
            "INSERT OR IGNORE INTO channels (team_name, name, description) VALUES (?, ?, ?)"
          )
          .run(teamName, name, def.description ?? null);

        const channelId =
          result.changes > 0
            ? Number(result.lastInsertRowid)
            : (
                this.db
                  .prepare(
                    "SELECT id FROM channels WHERE team_name = ? AND name = ?"
                  )
                  .get(teamName, name) as { id: number }
              ).id;

        const insertSignal = this.db.prepare(
          "INSERT OR IGNORE INTO channel_signals (channel_id, signal) VALUES (?, ?)"
        );
        for (const signal of def.signals) {
          insertSignal.run(channelId, signal);
        }
      }
    }

    // Subscriptions
    if (config.subscriptions) {
      const insertSub = this.db.prepare(
        "INSERT OR IGNORE INTO subscriptions (team_name, role, channel, signal) VALUES (?, ?, ?, ?)"
      );
      for (const [role, entries] of Object.entries(config.subscriptions)) {
        for (const entry of entries) {
          if (entry.signals && entry.signals.length > 0) {
            for (const signal of entry.signals) {
              insertSub.run(teamName, role, entry.channel, signal);
            }
          } else {
            // Subscribe to all signals in channel
            insertSub.run(teamName, role, entry.channel, null);
          }
        }
      }
    }

    // Emissions
    if (config.emissions) {
      const insertEmission = this.db.prepare(
        "INSERT OR IGNORE INTO emissions (team_name, role, signal) VALUES (?, ?, ?)"
      );
      for (const [role, signals] of Object.entries(config.emissions)) {
        for (const signal of signals) {
          insertEmission.run(teamName, role, signal);
        }
      }
    }

    // Peer routes
    if (config.routing?.peers) {
      const insertRoute = this.db.prepare(
        "INSERT INTO peer_routes (team_name, from_role, to_role, via, signals) VALUES (?, ?, ?, ?, ?)"
      );
      for (const peer of config.routing.peers) {
        insertRoute.run(
          teamName,
          peer.from,
          peer.to,
          peer.via,
          JSON.stringify(peer.signals ?? [])
        );
      }
    }
  }

  // --- Channels ---

  listChannels(teamName: string): ChannelInfo[] {
    const rows = this.db
      .prepare("SELECT * FROM channels WHERE team_name = ? ORDER BY name")
      .all(teamName) as Array<{ id: number; name: string; description: string | null }>;

    return rows.map((row) => {
      const signals = this.db
        .prepare("SELECT signal FROM channel_signals WHERE channel_id = ?")
        .all(row.id) as Array<{ signal: string }>;

      return {
        name: row.name,
        description: row.description,
        signals: signals.map((s) => s.signal),
      };
    });
  }

  getChannel(teamName: string, channelName: string): ChannelInfo | null {
    const row = this.db
      .prepare("SELECT * FROM channels WHERE team_name = ? AND name = ?")
      .get(teamName, channelName) as
      | { id: number; name: string; description: string | null }
      | undefined;

    if (!row) return null;

    const signals = this.db
      .prepare("SELECT signal FROM channel_signals WHERE channel_id = ?")
      .all(row.id) as Array<{ signal: string }>;

    return {
      name: row.name,
      description: row.description,
      signals: signals.map((s) => s.signal),
    };
  }

  // --- Subscriptions ---

  getSubscriptionsForRole(teamName: string, role: string): SubscriptionInfo[] {
    return this.db
      .prepare(
        "SELECT role, channel, signal FROM subscriptions WHERE team_name = ? AND role = ?"
      )
      .all(teamName, role) as SubscriptionInfo[];
  }

  listSubscriptions(teamName: string): SubscriptionInfo[] {
    return this.db
      .prepare(
        "SELECT role, channel, signal FROM subscriptions WHERE team_name = ? ORDER BY role, channel"
      )
      .all(teamName) as SubscriptionInfo[];
  }

  // --- Emissions ---

  getEmissionsForRole(teamName: string, role: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT signal FROM emissions WHERE team_name = ? AND role = ?"
      )
      .all(teamName, role) as Array<{ signal: string }>;
    return rows.map((r) => r.signal);
  }

  canEmit(teamName: string, role: string, signal: string): boolean {
    // If no emissions are declared for this team, allow all (permissive default)
    const anyEmissions = this.db
      .prepare("SELECT COUNT(*) as count FROM emissions WHERE team_name = ?")
      .get(teamName) as { count: number };

    if (anyEmissions.count === 0) return true;

    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM emissions WHERE team_name = ? AND role = ? AND signal = ?"
      )
      .get(teamName, role, signal) as { count: number };

    return row.count > 0;
  }

  // --- Peer Routes ---

  listPeerRoutes(teamName: string): PeerRouteInfo[] {
    const rows = this.db
      .prepare(
        "SELECT from_role, to_role, via, signals FROM peer_routes WHERE team_name = ?"
      )
      .all(teamName) as Array<{
      from_role: string;
      to_role: string;
      via: string;
      signals: string;
    }>;

    return rows.map((r) => ({
      ...r,
      signals: JSON.parse(r.signals),
    }));
  }

  getPeerRoutesForRole(teamName: string, role: string): PeerRouteInfo[] {
    const rows = this.db
      .prepare(
        "SELECT from_role, to_role, via, signals FROM peer_routes WHERE team_name = ? AND from_role = ?"
      )
      .all(teamName, role) as Array<{
      from_role: string;
      to_role: string;
      via: string;
      signals: string;
    }>;

    return rows.map((r) => ({
      ...r,
      signals: JSON.parse(r.signals),
    }));
  }

  // --- Enforcement ---

  getEnforcement(teamName: string): EnforcementMode {
    const row = this.db
      .prepare("SELECT enforcement FROM teams WHERE name = ?")
      .get(teamName) as { enforcement: EnforcementMode } | undefined;
    return row?.enforcement ?? "permissive";
  }

  // --- Signal Events ---

  emit(options: EmitSignalOptions): EmitResult {
    const enforcement = this.getEnforcement(options.teamName);
    const permitted = this.canEmit(
      options.teamName,
      options.sender,
      options.signal
    );

    if (!permitted && enforcement === "strict") {
      throw new Error(
        `Role "${options.sender}" is not permitted to emit signal "${options.signal}" (enforcement: strict)`
      );
    }

    const result = this.db
      .prepare(
        "INSERT INTO signal_events (team_name, channel, signal, sender, payload) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        options.teamName,
        options.channel,
        options.signal,
        options.sender,
        JSON.stringify(options.payload ?? {})
      );

    const event = this.getEvent(Number(result.lastInsertRowid))!;
    return { event, permitted, enforcement };
  }

  listEvents(
    teamName: string,
    filters?: { channel?: string; signal?: string; sender?: string }
  ): SignalEvent[] {
    let sql = "SELECT * FROM signal_events WHERE team_name = ?";
    const params: any[] = [teamName];

    if (filters?.channel) {
      sql += " AND channel = ?";
      params.push(filters.channel);
    }
    if (filters?.signal) {
      sql += " AND signal = ?";
      params.push(filters.signal);
    }
    if (filters?.sender) {
      sql += " AND sender = ?";
      params.push(filters.sender);
    }

    sql += " ORDER BY created_at ASC";

    const rows = this.db.prepare(sql).all(...params) as SignalEventRow[];
    return rows.map((r) => ({ ...r }));
  }

  /**
   * Get events that a role should receive based on its subscriptions.
   */
  getEventsForRole(teamName: string, role: string): SignalEvent[] {
    const subs = this.getSubscriptionsForRole(teamName, role);
    if (subs.length === 0) return [];

    const allEvents: SignalEvent[] = [];

    for (const sub of subs) {
      if (sub.signal) {
        // Signal-filtered subscription
        const rows = this.db
          .prepare(
            "SELECT * FROM signal_events WHERE team_name = ? AND channel = ? AND signal = ? ORDER BY created_at ASC"
          )
          .all(teamName, sub.channel, sub.signal) as SignalEventRow[];
        allEvents.push(...rows);
      } else {
        // Full channel subscription
        const rows = this.db
          .prepare(
            "SELECT * FROM signal_events WHERE team_name = ? AND channel = ? ORDER BY created_at ASC"
          )
          .all(teamName, sub.channel) as SignalEventRow[];
        allEvents.push(...rows);
      }
    }

    // Deduplicate by id and sort by created_at
    const seen = new Set<number>();
    return allEvents
      .filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  private getEvent(id: number): SignalEvent | null {
    const row = this.db
      .prepare("SELECT * FROM signal_events WHERE id = ?")
      .get(id) as SignalEventRow | undefined;
    return row ? { ...row } : null;
  }
}
