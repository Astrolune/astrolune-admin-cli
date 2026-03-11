import type { Command } from "commander";
import ora from "ora";
import pc from "picocolors";
import Table from "cli-table3";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printSuccess, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";
import { confirmPrompt } from "../utils/confirm.js";

export function registerSystemCommands(program: Command): void {
  const system = program.command("system").description("System operations");

  system
    .command("logs")
    .description("List system logs")
    .option("--level <error|warn|info>")
    .option("--take <n>", "rows limit", "50")
    .action(async (options: { level?: string; take: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading system logs...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/admin/system/logs", {
        level: options.level,
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} logs.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      if (!result.length) {
        printWarn("No results found");
        return;
      }

      const table = new Table({
        head: [
          pc.cyan("Timestamp"),
          pc.cyan("Level"),
          pc.cyan("Message"),
          pc.cyan("Service"),
        ],
        wordWrap: true,
        colWidths: [24, 10, 52, 20],
      });

      for (const item of result) {
        const level = String(item.level ?? item.severity ?? "info").toLowerCase();
        const color =
          level === "error" ? pc.red : level === "warn" ? pc.yellow : pc.gray;
        table.push([
          color(formatDate(item.timestamp ?? item.createdAt ?? item.date)),
          color(level),
          color(String(item.message ?? "-")),
          color(String(item.service ?? "-")),
        ]);
      }

      console.log(table.toString());
    });

  system
    .command("maintenance")
    .description("Toggle maintenance mode")
    .option("--enable", "enable maintenance mode")
    .option("--disable", "disable maintenance mode")
    .option("--message <text>", "maintenance message")
    .action(
      async (
        options: { enable?: boolean; disable?: boolean; message?: string },
        command: Command,
      ) => {
        if (options.enable && options.disable) {
          throw new Error("Choose either --enable or --disable, not both.");
        }
        if (!options.enable && !options.disable) {
          throw new Error("Specify --enable or --disable.");
        }
        if (options.enable && !options.message) {
          throw new Error("--message is required when enabling maintenance mode.");
        }

        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora("Updating maintenance mode...").start();
        const result = await api.post<Record<string, unknown>>("/admin/system/maintenance", {
          enabled: Boolean(options.enable),
          message: options.message ?? null,
        });
        spinner.succeed("Maintenance updated.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        printSuccess("Maintenance status updated.");
        console.log(`Enabled: ${result.enabled ?? options.enable}`);
        if (result.message) {
          console.log(`Message: ${result.message}`);
        }
      },
    );

  system
    .command("announce")
    .description("Show system announcement")
    .requiredOption("--text <text>")
    .requiredOption("--duration <minutes>")
    .action(
      async (
        options: { text: string; duration: string },
        command: Command,
      ) => {
        const duration = Number.parseInt(options.duration, 10);
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error("--duration must be a positive integer");
        }

        const confirmed = await confirmPrompt(
          `Show announcement to ALL users for ${duration} min? [y/N]`,
        );
        if (!confirmed) {
          printWarn("Announcement cancelled.");
          return;
        }

        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora("Sending announcement...").start();
        const result = await api.post<unknown>("/admin/system/announce", {
          text: options.text,
          duration,
        });
        spinner.succeed("Announcement sent.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        printSuccess("Announcement sent.");
      },
    );

  const config = system.command("config").description("System config");

  config
    .command("get <key>")
    .description("Get config value")
    .action(async (key: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Loading config ${key}...`).start();
      const result = await api.get<Record<string, unknown>>(`/admin/system/config/${key}`);
      spinner.succeed("Config loaded.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      if (typeof result.value !== "undefined") {
        console.log(result.value);
        return;
      }
      console.log(JSON.stringify(result));
    });

  config
    .command("set <key> <value>")
    .description("Set config value")
    .action(async (key: string, value: string, command: Command) => {
      const normalizedKey = key.trim().toLowerCase();
      if (normalizedKey === "jwt_secret" || normalizedKey.startsWith("admin_")) {
        const confirmed = await confirmPrompt(
          `Set sensitive config ${key}? [y/N]`,
        );
        if (!confirmed) {
          printWarn("Config update cancelled.");
          return;
        }
      }

      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Updating config ${key}...`).start();
      const result = await api.patch<unknown>(`/admin/system/config/${key}`, {
        value,
      });
      spinner.succeed("Config updated.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      printSuccess(`Config ${key} updated.`);
    });

  const admins = system.command("admins").description("Admin accounts");

  admins
    .command("list")
    .description("List admins")
    .action(async (_, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading admins...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/admin/system/admins");
      spinner.succeed(`Loaded ${result.length} admins.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      if (!result.length) {
        printWarn("No results found");
        return;
      }

      const table = new Table({
        head: [pc.cyan("ID"), pc.cyan("Username"), pc.cyan("Role"), pc.cyan("Last Active")],
        wordWrap: true,
        colWidths: [28, 20, 14, 24],
      });
      for (const item of result) {
        table.push([
          String(item.id ?? item.userId ?? "-"),
          String(item.username ?? "-"),
          String(item.role ?? "-"),
          formatDate(item.lastActive ?? item.updatedAt ?? item.createdAt),
        ]);
      }
      console.log(table.toString());
    });

  admins
    .command("add <userId>")
    .description("Add admin")
    .requiredOption("--role <admin|moderator>")
    .action(
      async (userId: string, options: { role: string }, command: Command) => {
        const role = options.role.trim().toLowerCase();
        if (!["admin", "moderator"].includes(role)) {
          throw new Error("--role must be admin or moderator");
        }
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora(`Adding admin ${userId}...`).start();
        const result = await api.post<unknown>("/admin/system/admins", { userId, role });
        spinner.succeed("Admin added.");

        if (runtime.json) {
          printJson(result);
          return;
        }

        printSuccess(`Admin ${userId} added with role ${role}.`);
      },
    );

  admins
    .command("remove <adminId>")
    .description("Remove admin")
    .action(async (adminId: string, command: Command) => {
      const confirmed = await confirmPrompt(`Remove admin ${adminId}? [y/N]`);
      if (!confirmed) {
        printWarn("Removal cancelled.");
        return;
      }

      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Removing admin ${adminId}...`).start();
      const result = await api.delete<unknown>(`/admin/system/admins/${adminId}`);
      spinner.succeed("Admin removed.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      console.log(pc.red("Admin removed."));
      printSuccess(`Admin ${adminId} removed.`);
    });
}
