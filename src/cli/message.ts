import { Command } from "commander";
import { MessageService } from "../services/message-service";
import type Database from "better-sqlite3";

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
    .action((team: string, opts) => {
      const msgs = opts.agent
        ? messageService.listForAgent(team, opts.agent)
        : messageService.listForTeam(team);

      if (msgs.length === 0) {
        console.log("No messages found.");
        return;
      }

      for (const m of msgs) {
        const to = m.recipient ? ` -> ${m.recipient}` : "";
        const summary = m.summary ? ` (${m.summary})` : "";
        console.log(
          `  #${m.id} [${m.type}] ${m.sender}${to}${summary}`
        );
        console.log(`    ${m.content}`);
      }
    });

  return message;
}
