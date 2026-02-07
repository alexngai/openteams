import type Database from "better-sqlite3";
import type {
  Message,
  MessageRow,
  SendMessageOptions,
  BroadcastMessageOptions,
  ShutdownRequestOptions,
  ShutdownResponseOptions,
  PlanApprovalResponseOptions,
} from "../types";
import { randomUUID } from "crypto";

function rowToMessage(row: MessageRow): Message {
  return {
    ...row,
    approve: row.approve === null ? null : row.approve === 1,
    delivered: row.delivered === 1,
  };
}

export class MessageService {
  constructor(private db: Database.Database) {}

  send(options: SendMessageOptions): Message {
    const result = this.db
      .prepare(
        `INSERT INTO messages (team_name, type, sender, recipient, content, summary)
         VALUES (?, 'message', ?, ?, ?, ?)`
      )
      .run(
        options.teamName,
        options.sender,
        options.recipient,
        options.content,
        options.summary
      );

    return this.getById(Number(result.lastInsertRowid))!;
  }

  broadcast(options: BroadcastMessageOptions): Message[] {
    const members = this.db
      .prepare(
        "SELECT agent_name FROM members WHERE team_name = ? AND status != 'shutdown'"
      )
      .all(options.teamName) as Array<{ agent_name: string }>;

    const messages: Message[] = [];
    for (const member of members) {
      if (member.agent_name === options.sender) continue;

      const result = this.db
        .prepare(
          `INSERT INTO messages (team_name, type, sender, recipient, content, summary)
           VALUES (?, 'broadcast', ?, ?, ?, ?)`
        )
        .run(
          options.teamName,
          options.sender,
          member.agent_name,
          options.content,
          options.summary
        );

      messages.push(this.getById(Number(result.lastInsertRowid))!);
    }

    return messages;
  }

  sendShutdownRequest(options: ShutdownRequestOptions): Message {
    const requestId = randomUUID();
    const result = this.db
      .prepare(
        `INSERT INTO messages (team_name, type, sender, recipient, content, request_id)
         VALUES (?, 'shutdown_request', ?, ?, ?, ?)`
      )
      .run(
        options.teamName,
        options.sender,
        options.recipient,
        options.reason ?? "Shutdown requested",
        requestId
      );

    return this.getById(Number(result.lastInsertRowid))!;
  }

  sendShutdownResponse(options: ShutdownResponseOptions): Message {
    const result = this.db
      .prepare(
        `INSERT INTO messages (team_name, type, sender, content, request_id, approve)
         VALUES (?, 'shutdown_response', ?, ?, ?, ?)`
      )
      .run(
        options.teamName,
        options.sender,
        options.content ?? (options.approve ? "Shutting down" : "Rejecting shutdown"),
        options.requestId,
        options.approve ? 1 : 0
      );

    return this.getById(Number(result.lastInsertRowid))!;
  }

  sendPlanApprovalResponse(options: PlanApprovalResponseOptions): Message {
    const result = this.db
      .prepare(
        `INSERT INTO messages (team_name, type, sender, recipient, content, request_id, approve)
         VALUES (?, 'plan_approval_response', ?, ?, ?, ?, ?)`
      )
      .run(
        options.teamName,
        options.sender,
        options.recipient,
        options.content ?? (options.approve ? "Plan approved" : "Plan rejected"),
        options.requestId,
        options.approve ? 1 : 0
      );

    return this.getById(Number(result.lastInsertRowid))!;
  }

  listForAgent(teamName: string, agentName: string): Message[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE team_name = ? AND (recipient = ? OR sender = ? OR type = 'broadcast')
         ORDER BY created_at ASC`
      )
      .all(teamName, agentName, agentName) as MessageRow[];

    return rows.map(rowToMessage);
  }

  listForTeam(teamName: string): Message[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM messages WHERE team_name = ? ORDER BY created_at ASC"
      )
      .all(teamName) as MessageRow[];

    return rows.map(rowToMessage);
  }

  getUndelivered(teamName: string, agentName: string): Message[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE team_name = ? AND recipient = ? AND delivered = 0
         ORDER BY created_at ASC`
      )
      .all(teamName, agentName) as MessageRow[];

    return rows.map(rowToMessage);
  }

  markDelivered(messageId: number): void {
    this.db
      .prepare("UPDATE messages SET delivered = 1 WHERE id = ?")
      .run(messageId);
  }

  private getById(id: number): Message | null {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as MessageRow | undefined;
    return row ? rowToMessage(row) : null;
  }
}
