import { Command } from "commander";
import { MessageService } from "../services/message-service";
import type { Message } from "../types";
import type Database from "better-sqlite3";

function messageToJson(m: Message) {
  return {
    id: m.id,
    team_name: m.team_name,
    type: m.type,
    sender: m.sender,
    recipient: m.recipient,
    content: m.content,
    summary: m.summary,
    request_id: m.request_id,
    approve: m.approve,
    delivered: m.delivered,
    created_at: m.created_at,
  };
}

export function createMessageCommands(db: Database.Database): Command {
  const messageService = new MessageService(db);
  const message = new Command("message").description("Send and view messages");

  message
    .command("send <team>")
    .description("Send a direct message to a teammate")
    .requiredOption("--to <recipient>", "Recipient agent name")
    .requiredOption("--content <content>", "Message content")
    .requiredOption("--summary <summary>", "Short summary (5-10 words)")
    .option("--from <sender>", "Sender name", "lead")
    .action((team: string, opts) => {
      try {
        const msg = messageService.send({
          teamName: team,
          sender: opts.from,
          recipient: opts.to,
          content: opts.content,
          summary: opts.summary,
        });
        console.log(`Message #${msg.id} sent to ${opts.to}.`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  message
    .command("broadcast <team>")
    .description("Broadcast a message to all teammates")
    .requiredOption("--content <content>", "Message content")
    .requiredOption("--summary <summary>", "Short summary (5-10 words)")
    .option("--from <sender>", "Sender name", "lead")
    .action((team: string, opts) => {
      try {
        const msgs = messageService.broadcast({
          teamName: team,
          sender: opts.from,
          content: opts.content,
          summary: opts.summary,
        });
        console.log(`Broadcast sent to ${msgs.length} teammate(s).`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  message
    .command("shutdown <team>")
    .description("Send a shutdown request to a teammate")
    .requiredOption("--to <recipient>", "Recipient agent name")
    .option("--reason <reason>", "Reason for shutdown")
    .option("--from <sender>", "Sender name", "lead")
    .action((team: string, opts) => {
      try {
        const msg = messageService.sendShutdownRequest({
          teamName: team,
          sender: opts.from,
          recipient: opts.to,
          reason: opts.reason,
        });
        console.log(
          `Shutdown request #${msg.id} sent to ${opts.to} (request_id: ${msg.request_id}).`
        );
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  message
    .command("list <team>")
    .description("List messages for a team or agent")
    .option("--agent <name>", "Filter messages for a specific agent")
    .option("--json", "Output as JSON")
    .action((team: string, opts) => {
      const msgs = opts.agent
        ? messageService.listForAgent(team, opts.agent)
        : messageService.listForTeam(team);

      if (opts.json) {
        console.log(JSON.stringify(msgs.map(messageToJson)));
        return;
      }

      if (msgs.length === 0) {
        console.log("No messages found.");
        return;
      }

      for (const m of msgs) {
        const to = m.recipient ? ` -> ${m.recipient}` : "";
        const summary = m.summary ? ` (${m.summary})` : "";
        const delivery = m.delivered ? "" : " [undelivered]";
        console.log(
          `  #${m.id} [${m.type}] ${m.sender}${to}${summary}${delivery}`
        );
        console.log(`    ${m.content}`);
      }
    });

  message
    .command("poll <team>")
    .description("List undelivered messages for an agent")
    .requiredOption("--agent <name>", "Agent name")
    .option("--mark-delivered", "Mark messages as delivered after listing")
    .option("--json", "Output as JSON")
    .action((team: string, opts) => {
      try {
        const msgs = messageService.getUndelivered(team, opts.agent);

        if (opts.json) {
          console.log(JSON.stringify(msgs.map(messageToJson)));
        } else if (msgs.length === 0) {
          console.log("No undelivered messages.");
        } else {
          for (const m of msgs) {
            const from = m.sender;
            const summary = m.summary ? ` (${m.summary})` : "";
            console.log(`  #${m.id} [${m.type}] ${from}${summary}`);
            console.log(`    ${m.content}`);
          }
        }

        if (opts.markDelivered) {
          for (const m of msgs) {
            messageService.markDelivered(m.id);
          }
          if (!opts.json && msgs.length > 0) {
            console.log(`Marked ${msgs.length} message(s) as delivered.`);
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  message
    .command("ack <team> <message-id>")
    .description("Mark a message as delivered")
    .action((team: string, messageId: string) => {
      try {
        const id = parseInt(messageId, 10);
        if (isNaN(id)) {
          throw new Error(`Invalid message ID: "${messageId}"`);
        }
        messageService.markDelivered(id);
        console.log(`Message #${id} marked as delivered.`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return message;
}
