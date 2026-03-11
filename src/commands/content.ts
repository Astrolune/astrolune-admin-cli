import type { Command } from "commander";
import ora from "ora";
import pc from "picocolors";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printSuccess, printTable, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";
import { confirmPrompt } from "../utils/confirm.js";
import { renderBox } from "../utils/box.js";
import { truncateText } from "../utils/text.js";

export function registerContentCommands(program: Command): void {
  const content = program.command("content").description("Content moderation tools");

  content
    .command("list")
    .description("List content items")
    .option("--type <post|comment|media>")
    .option("--status <pending|flagged|removed>")
    .option("--take <n>", "rows limit", "20")
    .action(async (options: { type?: string; status?: string; take: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading content...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/admin/content", {
        type: options.type,
        status: options.status,
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} items.`);

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
          id: item.id ?? item.contentId ?? "-",
          type: item.type ?? "-",
          status: item.status ?? "-",
          author: formatEntity(item.author ?? item.authorId ?? item.user),
          flags: item.flags ?? item.flagCount ?? "-",
          date: formatDate(item.createdAt ?? item.date ?? item.updatedAt),
        })),
        [
          { key: "id", title: "ID" },
          { key: "type", title: "Type" },
          { key: "status", title: "Status" },
          { key: "author", title: "Author" },
          { key: "flags", title: "Flags" },
          { key: "date", title: "Date" },
        ],
      );
    });

  content
    .command("view <contentId>")
    .description("View content details")
    .action(async (contentId: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Loading content ${contentId}...`).start();
      const result = await api.get<Record<string, unknown>>(`/admin/content/${contentId}`);
      spinner.succeed("Content loaded.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      const metadata = [
        `ID: ${readString(result, "id", "contentId") ?? contentId}`,
        `Type: ${readString(result, "type") ?? "-"}`,
        `Author: ${formatEntity(result.author ?? result.authorId ?? result.user)}`,
        `Created: ${formatDate(readString(result, "createdAt", "created") ?? "-")}`,
        `Flag count: ${
          readNumber(result, "flagCount", "flags") ??
          readNumber(readRecord(result, "metadata") ?? null, "flagCount") ??
          "-"
        }`,
      ];
      console.log(renderBox(metadata, { title: "Content Metadata" }));

      const body = readString(result, "body", "content", "text", "message") ?? "";
      const truncated = truncateText(body, 500);
      console.log(renderBox([truncated.text || "-"], { title: "Content Body" }));
      if (truncated.truncated) {
        printWarn("Content body truncated to 500 chars.");
      }

      const flags = (readArray(result, "flags") ?? []) as Array<Record<string, unknown>>;
      if (!flags.length) {
        printWarn("No flags recorded.");
        return;
      }

      printTable(
        flags.map((flag) => ({
          reason: flag.reason ?? "-",
          reporter: formatEntity(flag.reporter ?? flag.reporterId ?? flag.user),
          date: formatDate(flag.createdAt ?? flag.date ?? flag.updatedAt),
        })),
        [
          { key: "reason", title: "Reason" },
          { key: "reporter", title: "Reporter" },
          { key: "date", title: "Date" },
        ],
      );
    });

  content
    .command("remove <contentId>")
    .description("Remove content")
    .requiredOption("--reason <text>")
    .action(async (contentId: string, options: { reason: string }, command: Command) => {
      const confirmed = await confirmPrompt("Remove this content? [y/N]");
      if (!confirmed) {
        printWarn("Removal cancelled.");
        return;
      }

      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Removing content ${contentId}...`).start();
      const result = await api.deleteWithBody<unknown>(`/admin/content/${contentId}`, {
        reason: options.reason,
      });
      spinner.succeed("Content removed.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      console.log(pc.red("Content removed."));
      printSuccess(`Removed content ${contentId}.`);
    });

  content
    .command("restore <contentId>")
    .description("Restore content")
    .action(async (contentId: string, command: Command) => {
      const confirmed = await confirmPrompt("Restore this content? [y/N]");
      if (!confirmed) {
        printWarn("Restore cancelled.");
        return;
      }

      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Restoring content ${contentId}...`).start();
      const result = await api.post<unknown>(`/admin/content/${contentId}/restore`);
      spinner.succeed("Content restored.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      printSuccess(`Content ${contentId} restored.`);
    });

  content
    .command("pin <contentId>")
    .description("Pin content")
    .action(async (contentId: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Pinning content ${contentId}...`).start();
      const result = await api.post<unknown>(`/admin/content/${contentId}/pin`);
      spinner.succeed("Content pinned.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      printSuccess(`Content ${contentId} pinned.`);
    });

  content
    .command("scan")
    .description("Scan content for policy violations")
    .requiredOption("--type <spam|nsfw|toxic>")
    .action(async (options: { type: string }, command: Command) => {
      const scanType = options.type.trim().toLowerCase();
      if (!["spam", "nsfw", "toxic"].includes(scanType)) {
        throw new Error("--type must be one of: spam, nsfw, toxic");
      }

      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Scanning content...").start();
      const result = await api.post<Record<string, unknown>>("/admin/content/scan", {
        type: scanType,
      });
      spinner.succeed("Scan complete.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      const flaggedCount =
        readNumber(result, "flagged", "flaggedCount", "count") ?? "unknown";
      printSuccess(`Flagged items found: ${flaggedCount}.`);
    });
}

function readString(source: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readNumber(source: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!source) {
    return null;
  }
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

function readRecord(
  source: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | null {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function readArray(
  source: Record<string, unknown>,
  ...keys: string[]
): Array<unknown> | null {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function formatEntity(value: unknown): string {
  if (!value) {
    return "-";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return (
      readString(record, "username", "name") ??
      readString(record, "id", "userId") ??
      "-"
    );
  }
  return "-";
}
