import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { printJson, printTable } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";

export function registerAnalyticsCommands(program: Command): void {
  const analytics = program.command("analytics").description("Analytics endpoints");

  analytics
    .command("overview")
    .description("Get 30-day overview")
    .action(async (_, command: Command) => {
      await runAnalyticsRequest(command, "/analytics/overview");
    });

  analytics
    .command("messages")
    .description("Get message volume by day")
    .option("--from <iso-date>")
    .option("--to <iso-date>")
    .action(async (options: { from?: string; to?: string }, command: Command) => {
      await runAnalyticsRequest(command, "/analytics/messages", options);
    });

  analytics
    .command("moderation")
    .description("Get moderation efficiency metrics")
    .option("--from <iso-date>")
    .option("--to <iso-date>")
    .action(async (options: { from?: string; to?: string }, command: Command) => {
      await runAnalyticsRequest(command, "/analytics/moderation", options);
    });

  analytics
    .command("subscriptions")
    .description("Get subscriptions and revenue metrics")
    .option("--from <iso-date>")
    .option("--to <iso-date>")
    .action(async (options: { from?: string; to?: string }, command: Command) => {
      await runAnalyticsRequest(command, "/analytics/subscriptions", options);
    });
}

async function runAnalyticsRequest(command: Command, endpoint: string, query?: Record<string, string>): Promise<void> {
  const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
  const api = new ApiClient(runtime);
  const spinner = ora(`Loading ${endpoint}...`).start();
  const result = await api.get<unknown>(endpoint, query);
  spinner.succeed("Analytics loaded.");

  if (runtime.json) {
    printJson(result);
    return;
  }

  if (Array.isArray(result)) {
    const rows = result as Array<Record<string, unknown>>;
    const first = rows[0] ?? {};
    printTable(rows, Object.keys(first).map((key) => ({ key, title: key })));
    return;
  }

  printJson(result);
}
