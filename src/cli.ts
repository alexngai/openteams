#!/usr/bin/env node

import { Command } from "commander";
import { createDatabase } from "./db/database";
import { createTeamCommands } from "./cli/team";
import { createTaskCommands } from "./cli/task";
import { createMessageCommands } from "./cli/message";
import { createAgentCommands } from "./cli/agent";
import { createTemplateCommands } from "./cli/template";
import { createGenerateCommands } from "./cli/generate";
import { createEditorCommand } from "./cli/editor";
import { MockSpawner } from "./spawner/mock";
import { ClaudeCodeSpawner } from "./spawner/claude-code";
import type { AgentSpawner } from "./types";

function loadSpawner(): AgentSpawner {
  // Use Claude Code teams spawner when the feature flag is set
  if (process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1") {
    return new ClaudeCodeSpawner();
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ACPFactorySpawner } = require("./spawner/acp-factory");
    return new ACPFactorySpawner();
  } catch {
    // Fall back to mock spawner if acp-factory is not available
    return new MockSpawner();
  }
}

const db = createDatabase();
const spawner = loadSpawner();

const program = new Command();

program
  .name("openteams")
  .description("Multi-agent team coordination CLI")
  .version("0.1.0");

program.addCommand(createTeamCommands(db));
program.addCommand(createTaskCommands(db));
program.addCommand(createMessageCommands(db));
program.addCommand(createAgentCommands(db, spawner));
program.addCommand(createTemplateCommands(db));
program.addCommand(createGenerateCommands());
program.addCommand(createEditorCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
