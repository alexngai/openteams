#!/usr/bin/env node

import { Command } from "commander";
import { createTemplateCommands } from "./cli/template";
import { createGenerateCommands } from "./cli/generate";
import { createLoadoutCommands } from "./cli/loadout";
import { createEditorCommand } from "./cli/editor";

const program = new Command();

program
  .name("openteams")
  .description("Team structure definition and template toolkit")
  .version("0.3.0");

program.addCommand(createTemplateCommands());
program.addCommand(createGenerateCommands());
program.addCommand(createLoadoutCommands());
program.addCommand(createEditorCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
