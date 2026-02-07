#!/usr/bin/env node

import { Command } from "commander";
import { createDatabase } from "./db/database";
import { createTeamCommands } from "./cli/team";
import { createTaskCommands } from "./cli/task";
import { createMessageCommands } from "./cli/message";
import { createAgentCommands } from "./cli/agent";
import { MockSpawner } from "./spawner/mock";
import type { AgentSpawner } from "./types";

function loadSpawner(): AgentSpawner {
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

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
