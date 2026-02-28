#!/usr/bin/env node

import process from "node:process";
import { Command } from "commander";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerHealthCommands } from "./commands/health.js";
import { registerLogsCommands } from "./commands/logs.js";
import { registerServersCommands } from "./commands/servers.js";
import { registerUsersCommands } from "./commands/users.js";
import { registerWebhooksCommands } from "./commands/webhooks.js";
import { ApiError } from "./core/http.js";
import { printBanner, printError, printJson } from "./core/output.js";

const program = new Command();

program
  .name("astrolune-admin")
  .description("Astrolune admin command-line toolkit")
  .version("0.1.0")
  .option("-u, --url <url>", "admin API base URL, e.g. http://localhost:5007")
  .option("-t, --token <token>", "JWT token for admin API")
  .option("--timeout <ms>", "request timeout in ms")
  .option("--json", "print raw JSON output");

registerAuthCommands(program);
registerDoctorCommand(program);
registerHealthCommands(program);
registerUsersCommands(program);
registerServersCommands(program);
registerLogsCommands(program);
registerAnalyticsCommands(program);
registerWebhooksCommands(program);

program.hook("preAction", (_, actionCommand) => {
  const options = actionCommand.optsWithGlobals() as { json?: boolean };
  if (!options.json) {
    printBanner();
  }
});

if (process.argv.length <= 2) {
  program.help();
}

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof ApiError) {
    printError(`${error.message}`);
    if (error.details) {
      printJson(error.details);
    }
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    printError(error.message);
    process.exitCode = 1;
    return;
  }

  printError("Unknown error");
  process.exitCode = 1;
});
