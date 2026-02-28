import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printTable } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";

export function registerWebhooksCommands(program: Command): void {
  const webhooks = program.command("webhooks").description("Webhook management");

  webhooks
    .command("list")
    .description("List configured webhooks")
    .option("--event-type <eventType>")
    .action(async (options: { eventType?: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading webhooks...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/webhooks", {
        eventType: options.eventType,
      });
      spinner.succeed(`Loaded ${result.length} webhooks.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      printTable(
        result.map((item) => ({
          id: item.id,
          eventType: item.eventType,
          targetUrl: item.targetUrl,
          active: item.isActive,
          createdBy: item.createdBy,
          createdAt: formatDate(item.createdAt),
        })),
        [
          { key: "id", title: "ID" },
          { key: "eventType", title: "Event" },
          { key: "targetUrl", title: "Target URL" },
          { key: "active", title: "Active" },
          { key: "createdBy", title: "Created By" },
          { key: "createdAt", title: "Created At" },
        ],
      );
    });

  webhooks
    .command("create")
    .description("Create webhook")
    .requiredOption("--event-type <eventType>")
    .requiredOption("--url <targetUrl>")
    .requiredOption("--secret <secret>")
    .action(
      async (
        options: {
          eventType: string;
          url: string;
          secret: string;
        },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora("Creating webhook...").start();
        const result = await api.post<unknown>("/webhooks", {
          eventType: options.eventType,
          targetUrl: options.url,
          secret: options.secret,
        });
        spinner.succeed("Webhook created.");
        printJson(result);
      },
    );

  webhooks
    .command("disable <id>")
    .description("Disable webhook")
    .action(async (id: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Disabling webhook ${id}...`).start();
      const result = await api.delete<unknown>(`/webhooks/${id}`);
      spinner.succeed("Webhook disabled.");
      printJson(result);
    });
}
