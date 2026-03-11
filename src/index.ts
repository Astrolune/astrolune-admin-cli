#!/usr/bin/env node

import process from "node:process";
import { Command } from "commander";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerHealthCommands } from "./commands/health.js";
import { registerLogsCommands } from "./commands/logs.js";
import { registerModerationCommands } from "./commands/moderation.js";
import { registerNotifyCommands } from "./commands/notify.js";
import { registerReportsCommands } from "./commands/reports.js";
import { registerServersCommands } from "./commands/servers.js";
import { registerSystemCommands } from "./commands/system.js";
import { registerUsersCommands } from "./commands/users.js";
import { registerWebhooksCommands } from "./commands/webhooks.js";
import { registerContentCommands } from "./commands/content.js";
import { registerFunCommands } from "./commands/fun.js";
import { ApiError } from "./core/http.js";
import { printBanner, printError, printJson } from "./core/output.js";
import { setAuditContext } from "./utils/audit.js";

const program = new Command();

program
  .name("astrolune-admin")
  .description("Astrolune admin command-line toolkit")
  .version("0.1.0")
  .option("-u, --url <url>", "admin API base URL, e.g. http://localhost:5007")
  .option("--moderation-url <url>", "moderation API base URL, e.g. http://localhost:5008")
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
registerModerationCommands(program);
registerReportsCommands(program);
registerNotifyCommands(program);
registerContentCommands(program);
registerSystemCommands(program);
registerFunCommands(program);

program.hook("preAction", (_, actionCommand) => {
  const options = actionCommand.optsWithGlobals() as { json?: boolean };
  setAuditContext({
    command: getCommandPath(actionCommand),
    args: process.argv.slice(2),
  });
  if (!options.json) {
    printBanner();
  }
});

if (process.argv.length <= 2) {
  program.help();
}

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof ApiError) {
    handleApiError(error);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    if (isNetworkError(error)) {
      printError("Cannot reach API. Check config: admin config set-url <url>");
    } else {
      printError(error.message);
    }
    process.exitCode = 1;
    return;
  }

  printError("Unknown error");
  process.exitCode = 1;
});

function handleApiError(error: ApiError): void {
  switch (error.status) {
    case 401:
      printError("Auth failed. Run: admin auth login");
      return;
    case 403:
      printError("Permission denied for your role");
      return;
    case 404: {
      const message = formatNotFound(error.endpoint);
      printError(message);
      return;
    }
    case 422:
      printError("Validation failed.");
      if (error.details !== undefined) {
        console.error(JSON.stringify(error.details, null, 2));
      }
      return;
    default:
      printError(`${error.message}`);
      if (error.details !== undefined) {
        console.error(JSON.stringify(error.details, null, 2));
      }
  }
}

function formatNotFound(endpoint?: string): string {
  if (!endpoint) {
    return "Not found";
  }
  const clean = endpoint.split("?")[0];
  const parts = clean.split("/").filter(Boolean);
  const segments = parts[0] === "admin" ? parts.slice(1) : parts;
  const resource = segments[0] ?? "resource";
  const id = segments[1];
  if (id) {
    return `Not found: ${resource} #${id}`;
  }
  return `Not found: ${resource}`;
}

function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("socket") ||
    message.includes("getaddrinfo")
  );
}

function getCommandPath(command: Command): string {
  const parts: string[] = [];
  let current: Command | null = command;
  while (current) {
    const name = current.name();
    if (name) {
      parts.unshift(name);
    }
    current = current.parent ?? null;
  }
  return parts.join(" ");
}
