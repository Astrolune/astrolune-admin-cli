import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printSuccess, printTable, printWarn } from "../core/output.js";
import type { GlobalOptions, RuntimeContext } from "../core/types.js";
import { confirmPrompt } from "../utils/confirm.js";
import { isIsoDate } from "../utils/text.js";

export function registerNotifyCommands(program: Command): void {
  const notify = program.command("notify").description("Admin notification tools");

  notify
    .command("send <userId>")
    .description("Send notification to a user")
    .requiredOption("--title <text>")
    .requiredOption("--message <text>")
    .option("--type <info|warning|alert>", "notification type", "info")
    .action(
      async (
        userId: string,
        options: { title: string; message: string; type: string },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const type = normalizeNotificationType(options.type);
        const api = new ApiClient(runtime);
        const spinner = ora(`Sending notification to ${userId}...`).start();
        const result = await api.post<unknown>("/admin/notifications/send", {
          userId,
          title: options.title,
          message: options.message,
          type,
        });
        spinner.succeed("Notification sent.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        printSuccess(`Notification sent to ${userId}.`);
      },
    );

  notify
    .command("broadcast")
    .description("Broadcast notification to a segment")
    .requiredOption("--segment <all|premium|new>")
    .requiredOption("--title <text>")
    .requiredOption("--message <text>")
    .action(
      async (
        options: { segment: string; title: string; message: string },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const segment = options.segment.trim().toLowerCase();
        if (!["all", "premium", "new"].includes(segment)) {
          throw new Error("--segment must be one of: all, premium, new");
        }

        const confirmed = await confirmPrompt(
          `Send to ALL users in segment '${segment}'? [y/N]`,
        );
        if (!confirmed) {
          printWarn("Broadcast cancelled.");
          return;
        }

        const api = new ApiClient(runtime);
        const spinner = ora("Sending broadcast...").start();
        const result = await api.post<Record<string, unknown>>("/admin/notifications/broadcast", {
          segment,
          title: options.title,
          message: options.message,
        });
        spinner.succeed("Broadcast sent.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        const estimate =
          readNumber(result, "estimatedRecipients", "recipientCount", "estimatedCount") ?? null;
        if (estimate !== null) {
          printSuccess(`Broadcast sent. Estimated recipients: ${estimate}.`);
        } else {
          printSuccess("Broadcast sent.");
        }
      },
    );

  notify
    .command("schedule <userId>")
    .description("Schedule a notification for a user")
    .requiredOption("--at <iso-datetime>")
    .requiredOption("--title <text>")
    .requiredOption("--message <text>")
    .action(
      async (
        userId: string,
        options: { at: string; title: string; message: string },
        command: Command,
      ) => {
        const scheduledAt = options.at.trim();
        if (!isIsoDate(scheduledAt)) {
          throw new Error("--at must be a valid ISO datetime");
        }
        const scheduledDate = new Date(scheduledAt);
        if (scheduledDate.valueOf() <= Date.now()) {
          throw new Error("--at must be a future datetime");
        }

        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora("Scheduling notification...").start();
        const result = await api.post<unknown>("/admin/notifications/schedule", {
          userId,
          scheduledAt: scheduledAt,
          title: options.title,
          message: options.message,
        });
        spinner.succeed("Notification scheduled.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        printSuccess(`Notification scheduled for ${formatDate(scheduledAt)}.`);
      },
    );

  const templates = notify.command("templates").description("Notification templates");

  templates
    .command("list")
    .description("List notification templates")
    .action(async (_, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading templates...").start();
      const result = await api.get<Array<Record<string, unknown>>>(
        "/admin/notifications/templates",
      );
      spinner.succeed(`Loaded ${result.length} templates.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      if (!result.length) {
        printWarn("No results found");
        return;
      }

      printTable(
        result.map((template) => ({
          id: template.id ?? template.templateId ?? "-",
          name: template.name ?? "-",
          type: template.type ?? "-",
          variables: Array.isArray(template.variables)
            ? template.variables.join(", ")
            : template.variables ?? "-",
        })),
        [
          { key: "id", title: "ID" },
          { key: "name", title: "Name" },
          { key: "type", title: "Type" },
          { key: "variables", title: "Variables" },
        ],
      );
    });

  templates
    .command("use <templateId>")
    .description("Send a template notification")
    .requiredOption("--user <userId>")
    .requiredOption("--vars <json>")
    .action(
      async (
        templateId: string,
        options: { user: string; vars: string },
        command: Command,
      ) => {
        const variables = parseJsonObject(options.vars, "--vars");
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora("Sending template...").start();
        const result = await api.post<unknown>(
          `/admin/notifications/templates/${templateId}/send`,
          {
            userId: options.user,
            variables,
          },
        );
        spinner.succeed("Template sent.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        printSuccess(`Template ${templateId} sent to ${options.user}.`);
      },
    );

  notify
    .command("history <userId>")
    .description("List notification history for a user")
    .option("--take <n>", "rows limit", "20")
    .action(async (userId: string, options: { take: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Loading notification history for ${userId}...`).start();
      const result = await api.get<Array<Record<string, unknown>>>(
        `/admin/notifications/history/${userId}`,
        {
          take: options.take,
        },
      );
      spinner.succeed(`Loaded ${result.length} notifications.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      if (!result.length) {
        printWarn("No results found");
        return;
      }

      printTable(
        result.map((item) => ({
          id: item.id ?? "-",
          title: item.title ?? "-",
          type: item.type ?? "-",
          status: item.status ?? "-",
          sentAt: formatDate(item.sentAt ?? item.createdAt ?? item.updatedAt),
        })),
        [
          { key: "id", title: "ID" },
          { key: "title", title: "Title" },
          { key: "type", title: "Type" },
          { key: "status", title: "Status" },
          { key: "sentAt", title: "Sent At" },
        ],
      );
    });

  notify
    .command("cancel <notificationId>")
    .description("Cancel a scheduled notification")
    .action(async (notificationId: string, command: Command) => {
      const confirmed = await confirmPrompt("Cancel this notification? [y/N]");
      if (!confirmed) {
        printWarn("Cancellation aborted.");
        return;
      }

      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Cancelling notification ${notificationId}...`).start();
      const result = await api.delete<unknown>(`/admin/notifications/${notificationId}`);
      spinner.succeed("Notification cancelled.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      printSuccess(`Notification ${notificationId} cancelled.`);
    });
}

export async function sendLegacyNotificationToUser(
  runtime: RuntimeContext,
  userId: string,
  options: {
    title: string;
    message: string;
    kind: string;
    channel?: string;
    metadata?: string;
  },
): Promise<unknown> {
  const api = new ApiClient(runtime);
  const spinner = ora(`Sending notification to ${userId}...`).start();
  const result = await api.post<unknown>(`/users/${userId}/notify`, {
    title: options.title,
    message: options.message,
    kind: options.kind,
    channelId: options.channel || null,
    metadata: parseOptionalJson(options.metadata),
  });
  spinner.succeed("Notification sent.");
  return result;
}

export async function sendLegacyNotificationToMany(
  runtime: RuntimeContext,
  options: {
    ids: string;
    title: string;
    message: string;
    kind: string;
    channel?: string;
    metadata?: string;
  },
): Promise<unknown> {
  const userIds = options.ids
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (userIds.length === 0) {
    throw new Error("ids must include at least one user id");
  }

  const api = new ApiClient(runtime);
  const spinner = ora(`Sending notification to ${userIds.length} users...`).start();
  const result = await api.post<unknown>("/users/notify", {
    userIds,
    title: options.title,
    message: options.message,
    kind: options.kind,
    channelId: options.channel || null,
    metadata: parseOptionalJson(options.metadata),
  });
  spinner.succeed("Notifications sent.");
  return result;
}

export async function sendLegacyNotificationToAll(
  runtime: RuntimeContext,
  options: {
    title: string;
    message: string;
    kind: string;
    channel?: string;
    metadata?: string;
  },
): Promise<unknown> {
  const api = new ApiClient(runtime);
  const spinner = ora("Sending notification to all users...").start();
  const result = await api.post<unknown>("/users/notify-all", {
    title: options.title,
    message: options.message,
    kind: options.kind,
    channelId: options.channel || null,
    metadata: parseOptionalJson(options.metadata),
  });
  spinner.succeed("Notifications sent.");
  return result;
}

function normalizeNotificationType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!["info", "warning", "alert"].includes(normalized)) {
    throw new Error("--type must be one of: info, warning, alert");
  }
  return normalized;
}

function parseJsonObject(value: string, flag: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${flag} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function parseOptionalJson(value: string | undefined): Record<string, unknown> | null {
  if (!value || !value.trim()) {
    return null;
  }
  return parseJsonObject(value, "--metadata");
}

function readNumber(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}
