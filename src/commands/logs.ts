import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printTable } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";

export function registerLogsCommands(program: Command): void {
  const logs = program.command("logs").description("Admin logs");

  logs
    .command("audit")
    .description("List audit logs")
    .option("--admin-id <id>")
    .option("--action <action>")
    .option("--take <n>", "rows limit", "100")
    .action(async (options: { adminId?: string; action?: string; take: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading audit logs...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/logs/audit", {
        adminId: options.adminId,
        action: options.action,
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} rows.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      printTable(
        result.map((item) => ({
          id: item.id,
          adminId: item.adminId,
          action: item.action,
          targetType: item.targetType,
          targetId: item.targetId,
          createdAt: formatDate(item.createdAt),
        })),
        [
          { key: "id", title: "ID" },
          { key: "adminId", title: "Admin" },
          { key: "action", title: "Action" },
          { key: "targetType", title: "Target Type" },
          { key: "targetId", title: "Target ID" },
          { key: "createdAt", title: "Created" },
        ],
      );
    });

  logs
    .command("security")
    .description("List security events")
    .option("--severity <level>")
    .option("--take <n>", "rows limit", "100")
    .action(async (options: { severity?: string; take: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading security logs...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/logs/security", {
        severity: options.severity,
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} rows.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      printTable(
        result.map((item) => ({
          id: item.id,
          eventType: item.eventType,
          severity: item.severity,
          source: item.source,
          createdAt: formatDate(item.createdAt),
        })),
        [
          { key: "id", title: "ID" },
          { key: "eventType", title: "Event Type" },
          { key: "severity", title: "Severity" },
          { key: "source", title: "Source" },
          { key: "createdAt", title: "Created" },
        ],
      );
    });

  logs
    .command("system")
    .description("List system logs")
    .option("--service <name>")
    .option("--take <n>", "rows limit", "100")
    .action(async (options: { service?: string; take: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading system logs...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/logs/system", {
        service: options.service,
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} rows.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      printTable(
        result.map((item) => ({
          id: item.id,
          service: item.service,
          level: item.level,
          message: item.message,
          createdAt: formatDate(item.createdAt),
        })),
        [
          { key: "id", title: "ID" },
          { key: "service", title: "Service" },
          { key: "level", title: "Level" },
          { key: "message", title: "Message" },
          { key: "createdAt", title: "Created" },
        ],
      );
    });
}
