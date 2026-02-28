import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printTable, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";

type ServerListItem = {
  serverId: string;
  name: string;
  trustScore: number;
  trustLevel: number;
  membersCount: number;
  isFrozen: boolean;
  updatedAt: string;
};

export function registerServersCommands(program: Command): void {
  const servers = program.command("servers").description("Admin server operations");

  servers
    .command("list")
    .description("List server profiles")
    .option("--trust-level <n>")
    .option("--members-min <n>")
    .option("--frozen <true|false>")
    .option("--take <n>", "number of servers", "100")
    .action(async (options: Record<string, string>, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading servers...").start();
      const result = await api.get<ServerListItem[]>("/servers", {
        trustLevel: options["trustLevel"],
        membersMin: options["membersMin"],
        frozen: parseBooleanOption(options.frozen),
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} servers.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      printTable(
        result.map((server) => ({
          serverId: server.serverId,
          name: server.name,
          trustScore: server.trustScore,
          trustLevel: server.trustLevel,
          members: server.membersCount,
          frozen: server.isFrozen,
          updatedAt: formatDate(server.updatedAt),
        })),
        [
          { key: "serverId", title: "Server ID" },
          { key: "name", title: "Name" },
          { key: "trustScore", title: "Trust Score" },
          { key: "trustLevel", title: "Trust Level" },
          { key: "members", title: "Members" },
          { key: "frozen", title: "Frozen" },
          { key: "updatedAt", title: "Updated" },
        ],
      );
    });

  servers
    .command("get <id>")
    .description("Get detailed server profile")
    .action(async (id: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Loading server ${id}...`).start();
      const result = await api.get<unknown>(`/servers/${id}`);
      spinner.succeed("Server loaded.");
      printJson(result);
    });

  servers
    .command("trust <id>")
    .description("Update trust score for server")
    .requiredOption("--score <n>")
    .requiredOption("--reason <text>")
    .action(async (id: string, options: { score: string; reason: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const score = Number.parseInt(options.score, 10);
      if (!Number.isFinite(score) || score < 0 || score > 1000) {
        printWarn("score must be an integer between 0 and 1000.");
        return;
      }
      const spinner = ora(`Updating trust for ${id}...`).start();
      const result = await api.patch<unknown>(`/servers/${id}/trust`, {
        trustScore: score,
        reason: options.reason,
      });
      spinner.succeed("Trust updated.");
      printJson(result);
    });

  servers
    .command("freeze <id>")
    .description("Freeze server state")
    .requiredOption("--reason <text>")
    .option("--minutes <n>")
    .action(async (id: string, options: { reason: string; minutes?: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Freezing server ${id}...`).start();
      const result = await api.post<unknown>(`/servers/${id}/freeze`, {
        reason: options.reason,
        durationMinutes: options.minutes ? Number.parseInt(options.minutes, 10) : null,
      });
      spinner.succeed("Server frozen.");
      printJson(result);
    });

  servers
    .command("delete <id>")
    .description("Force-delete server snapshot")
    .action(async (id: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Deleting server ${id}...`).start();
      const result = await api.delete<unknown>(`/servers/${id}`);
      spinner.succeed("Server deleted.");
      printJson(result);
    });
}

function parseBooleanOption(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}
