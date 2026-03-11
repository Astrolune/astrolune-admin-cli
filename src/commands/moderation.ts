import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { printJson } from "../core/output.js";
import type { GlobalOptions, RuntimeContext } from "../core/types.js";

type ModerationQueueItem = Record<string, unknown>;
type ModerationDecision = Record<string, unknown>;
type ModerationSanction = Record<string, unknown>;

export function registerModerationCommands(program: Command): void {
  const moderation = program.command("moderation").description("Moderation service operations");

  moderation
    .command("enqueue")
    .description("Enqueue a message for moderation")
    .requiredOption("--message-id <id>")
    .requiredOption("--user-id <id>")
    .requiredOption("--channel-id <id>")
    .requiredOption("--content <text>")
    .option("--guild-id <id>")
    .option("--context <csv>", "comma separated context messages")
    .action(
      async (
        options: {
          messageId: string;
          userId: string;
          channelId: string;
          content: string;
          guildId?: string;
          context?: string;
        },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = createModerationClient(runtime);
        const spinner = ora("Enqueuing message...").start();
        const payload = {
          messageId: options.messageId,
          userId: options.userId,
          channelId: options.channelId,
          guildId: options.guildId || null,
          content: options.content,
          contextMessages: parseCsv(options.context),
        };
        const result = await api.post<Record<string, unknown>>("/messages/enqueue", payload);
        spinner.succeed("Message enqueued.");
        printJson(result);
      },
    );

  const queue = moderation.command("queue").description("Moderation queue");

  queue
    .command("list")
    .description("List queue items")
    .option("--take <n>", "max items", "50")
    .option("--label <label>")
    .option("--min-priority <n>")
    .action(
      async (
        options: { take: string; label?: string; minPriority?: string },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = createModerationClient(runtime);
        const spinner = ora("Loading moderation queue...").start();
        const result = await api.get<ModerationQueueItem[]>("/queue", {
          take: options.take,
          label: options.label,
          minPriority: options.minPriority,
        });
        spinner.succeed(`Loaded ${result.length} queue items.`);
        printJson(result);
      },
    );

  queue
    .command("get <queueItemId>")
    .description("Get queue item details")
    .action(async (queueItemId: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = createModerationClient(runtime);
      const spinner = ora(`Loading queue item ${queueItemId}...`).start();
      const result = await api.get<ModerationQueueItem>(`/queue/${queueItemId}`);
      spinner.succeed("Queue item loaded.");
      printJson(result);
    });

  queue
    .command("resolve <queueItemId>")
    .description("Resolve queue item")
    .option("--action <action>", "resolve|reject|flag", "resolve")
    .option("--note <text>")
    .action(
      async (
        queueItemId: string,
        options: { action?: string; note?: string },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = createModerationClient(runtime);
        const spinner = ora(`Resolving queue item ${queueItemId}...`).start();
        const result = await api.post<Record<string, unknown>>(`/queue/${queueItemId}/resolve`, {
          action: (options.action ?? "resolve").toLowerCase(),
          resolutionNote: options.note ?? null,
        });
        spinner.succeed("Queue item resolved.");
        printJson(result);
      },
    );

  moderation
    .command("sanctions")
    .description("List sanctions")
    .option("--take <n>", "max items", "50")
    .option("--user-id <id>")
    .action(async (options: { take: string; userId?: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = createModerationClient(runtime);
      const spinner = ora("Loading sanctions...").start();
      const result = await api.get<ModerationSanction[]>("/sanctions", {
        take: options.take,
        userId: options.userId,
      });
      spinner.succeed(`Loaded ${result.length} sanctions.`);
      printJson(result);
    });

  moderation
    .command("stats")
    .description("Get moderation stats")
    .action(async (_, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = createModerationClient(runtime);
      const spinner = ora("Loading moderation stats...").start();
      const result = await api.get<Record<string, unknown>>("/stats");
      spinner.succeed("Stats loaded.");
      printJson(result);
    });

  moderation
    .command("decisions")
    .description("List moderation decisions")
    .option("--take <n>", "max items", "50")
    .option("--from <iso>")
    .option("--to <iso>")
    .option("--label <label>")
    .action(
      async (
        options: { take: string; from?: string; to?: string; label?: string },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = createModerationClient(runtime);
        const spinner = ora("Loading moderation decisions...").start();
        const result = await api.get<ModerationDecision[]>("/decisions", {
          take: options.take,
          from: options.from,
          to: options.to,
          label: options.label,
        });
        spinner.succeed(`Loaded ${result.length} decisions.`);
        printJson(result);
      },
    );
}

function createModerationClient(runtime: RuntimeContext) {
  return new ApiClient(runtime, `${runtime.moderationBaseUrl}/api/moderation/v1`);
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
