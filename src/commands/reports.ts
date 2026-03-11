import type { Command } from "commander";
import ora from "ora";
import pc from "picocolors";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printSuccess, printTable, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";
import { promptInput } from "../utils/prompt.js";
import { renderBox } from "../utils/box.js";
import { truncateText } from "../utils/text.js";

export function registerReportsCommands(program: Command): void {
  const reports = program.command("reports").description("Report management");

  reports
    .command("list")
    .description("List reports")
    .option("--status <open|resolved|dismissed>")
    .option("--type <spam|abuse|other>")
    .option("--take <n>", "rows limit", "20")
    .action(async (options: { status?: string; type?: string; take: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading reports...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/admin/reports", {
        status: options.status,
        type: options.type,
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} reports.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      if (!result.length) {
        printWarn("No results found");
        return;
      }

      printTable(
        result.map((report) => ({
          id: report.id ?? report.reportId ?? "-",
          type: report.type ?? "-",
          status: report.status ?? "-",
          target: formatEntity(report.target ?? report.targetId ?? report.targetUser),
          reporter: formatEntity(report.reporter ?? report.reporterId ?? report.reporterUser),
          date: formatDate(report.createdAt ?? report.created ?? report.date),
        })),
        [
          { key: "id", title: "ID" },
          { key: "type", title: "Type" },
          { key: "status", title: "Status" },
          { key: "target", title: "Target" },
          { key: "reporter", title: "Reporter" },
          { key: "date", title: "Date" },
        ],
      );
    });

  reports
    .command("view <reportId>")
    .description("View report details")
    .action(async (reportId: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Loading report ${reportId}...`).start();
      const result = await api.get<Record<string, unknown>>(`/admin/reports/${reportId}`);
      spinner.succeed("Report loaded.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      const infoLines = [
        `ID: ${readString(result, "id", "reportId") ?? reportId}`,
        `Type: ${readString(result, "type") ?? "-"}`,
        `Status: ${readString(result, "status") ?? "-"}`,
        `Created: ${formatDate(readString(result, "createdAt", "created") ?? "-")}`,
      ];
      console.log(renderBox(infoLines, { title: "Report Info" }));

      const content = readString(result, "content", "reportedContent", "body", "message") ?? "";
      const truncated = truncateText(content, 300);
      console.log(renderBox([truncated.text || "-"], { title: "Reported Content" }));
      if (truncated.truncated) {
        printWarn("Reported content truncated to 300 chars.");
      }

      const reporter = readRecord(result, "reporter", "reporterUser", "reporterInfo");
      console.log(
        renderBox(
          [
            `ID: ${readString(reporter, "id", "userId") ?? "-"}`,
            `Username: ${readString(reporter, "username") ?? "-"}`,
          ],
          { title: "Reporter" },
        ),
      );

      const target = readRecord(result, "target", "targetUser", "targetInfo");
      const warnCount =
        readNumber(target, "warnCount", "warnings") ?? readNumber(result, "warnCount");
      console.log(
        renderBox(
          [
            `ID: ${readString(target, "id", "userId") ?? "-"}`,
            `Username: ${readString(target, "username") ?? "-"}`,
            `Warnings: ${warnCount !== null ? warnCount : "-"}`,
          ],
          { title: "Target" },
        ),
      );

      const history =
        (readArray(result, "moderationHistory", "history") ?? []) as Array<Record<string, unknown>>;
      if (!history.length) {
        printWarn("No moderation history found.");
        return;
      }

      printTable(
        history.map((item) => ({
          action: item.action ?? "-",
          note: item.note ?? item.reason ?? "-",
          admin: formatEntity(item.admin ?? item.adminId ?? item.moderator),
          date: formatDate(item.createdAt ?? item.date ?? item.updatedAt),
        })),
        [
          { key: "action", title: "Action" },
          { key: "note", title: "Note" },
          { key: "admin", title: "Admin" },
          { key: "date", title: "Date" },
        ],
      );
    });

  reports
    .command("assign <reportId>")
    .description("Assign report to admin")
    .requiredOption("--to <adminId>")
    .action(
      async (reportId: string, options: { to: string }, command: Command) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora(`Assigning report ${reportId}...`).start();
        const result = await api.patch<unknown>(`/admin/reports/${reportId}/assign`, {
          adminId: options.to,
        });
        spinner.succeed("Report assigned.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        printSuccess(`Report ${reportId} assigned to ${options.to}.`);
      },
    );

  reports
    .command("resolve <reportId>")
    .description("Resolve report")
    .requiredOption("--action <warn|ban|dismiss>")
    .option("--note <text>")
    .action(
      async (
        reportId: string,
        options: { action: string; note?: string },
        command: Command,
      ) => {
        const action = options.action.trim().toLowerCase();
        if (!["warn", "ban", "dismiss"].includes(action)) {
          throw new Error("--action must be one of: warn, ban, dismiss");
        }

        let duration: number | "permanent" | null = null;
        if (action === "ban") {
          duration = await promptBanDuration();
        }

        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora(`Resolving report ${reportId}...`).start();
        const result = await api.post<Record<string, unknown>>(`/admin/reports/${reportId}/resolve`, {
          action,
          note: options.note ?? null,
          duration,
        });
        spinner.succeed("Report resolved.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        printSuccess("Report resolved.");
        const summary = [
          { field: "Report", value: reportId },
          { field: "Action", value: action },
          { field: "Note", value: options.note ?? "-" },
          { field: "Duration", value: duration ?? "-" },
        ];
        if (action === "ban") {
          console.log(pc.red("Ban applied."));
        }
        printTable(summary, [
          { key: "field", title: "Field" },
          { key: "value", title: "Value" },
        ]);
      },
    );

  reports
    .command("stats")
    .description("Report statistics")
    .action(async (_, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading report stats...").start();
      const result = await api.get<Record<string, unknown>>("/admin/reports/stats");
      spinner.succeed("Stats loaded.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      const open = readNumber(result, "open", "openCount") ?? 0;
      const resolved = readNumber(result, "resolved", "resolvedCount") ?? 0;
      const dismissed = readNumber(result, "dismissed", "dismissedCount") ?? 0;
      console.log(
        `${pc.yellow(String(open))} open | ${pc.green(String(resolved))} resolved | ${pc.dim(
          String(dismissed),
        )} dismissed`,
      );

      const topTypes =
        (readArray(result, "topTypes", "topReportTypes") ?? []) as Array<Record<string, unknown>>;
      if (topTypes.length) {
        printTable(
          topTypes.slice(0, 3).map((item, index) => ({
            rank: index + 1,
            type: item.type ?? item.name ?? "-",
            count: item.count ?? item.total ?? "-",
          })),
          [
            { key: "rank", title: "Rank" },
            { key: "type", title: "Type" },
            { key: "count", title: "Count" },
          ],
        );
      } else {
        printWarn("No report type data available.");
      }

      const avgResolution =
        readString(result, "avgResolutionTime", "averageResolutionTime") ??
        readString(result, "avgResolution") ??
        "-";
      console.log(`Avg resolution time: ${avgResolution}`);
    });
}

async function promptBanDuration(): Promise<number | "permanent"> {
  const answer = await promptInput('Ban duration (minutes or "permanent"):');
  const normalized = answer.trim().toLowerCase();
  if (normalized === "permanent") {
    return "permanent";
  }
  const minutes = Number.parseInt(normalized, 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('Ban duration must be a positive integer or "permanent"');
  }
  return minutes;
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
