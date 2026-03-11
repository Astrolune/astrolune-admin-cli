import type { Command } from "commander";
import ora from "ora";
import pc from "picocolors";
import Table from "cli-table3";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printSuccess, printTable, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";
import { confirmPrompt } from "../utils/confirm.js";
import {
  sendLegacyNotificationToAll,
  sendLegacyNotificationToMany,
  sendLegacyNotificationToUser,
} from "./notify.js";

type UserListItem = {
  userId: string;
  username: string;
  displayName?: string;
  isBanned: boolean;
  isSuspicious: boolean;
  isPremium: boolean;
  isOnline: boolean;
  updatedAt: string;
};

type UserLookupMatch = {
  user: UserListItem;
  rank: number;
  matchedBy: "userId" | "username" | "displayName";
};

export function registerUsersCommands(program: Command): void {
  const users = program.command("users").description("Admin user operations");

  users
    .command("list")
    .description("List users with optional filters")
    .option("--banned <true|false>")
    .option("--suspicious <true|false>")
    .option("--premium <true|false>")
    .option("--online <true|false>")
    .option("--take <n>", "number of users", "100")
    .action(async (options: Record<string, string>, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading users...").start();
      const result = await api.get<UserListItem[]>("/users", {
        banned: parseBooleanOption(options.banned),
        suspicious: parseBooleanOption(options.suspicious),
        premium: parseBooleanOption(options.premium),
        online: parseBooleanOption(options.online),
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} users.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      const rows = result.map((user) => ({
        userId: user.userId,
        username: user.username,
        banned: user.isBanned,
        suspicious: user.isSuspicious,
        premium: user.isPremium,
        online: user.isOnline,
        updatedAt: formatDate(user.updatedAt),
      }));
      printTable(rows, [
        { key: "userId", title: "User ID" },
        { key: "username", title: "Username" },
        { key: "banned", title: "Banned" },
        { key: "suspicious", title: "Suspicious" },
        { key: "premium", title: "Premium" },
        { key: "online", title: "Online" },
        { key: "updatedAt", title: "Updated" },
      ]);
    });

  users
    .command("get <id>")
    .description("Get detailed user profile")
    .action(async (id: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Loading user ${id}...`).start();
      const profile = await api.get<unknown>(`/users/${id}`);
      spinner.succeed("User loaded.");
      printJson(profile);
    });

  users
    .command("id <query>")
    .description("Resolve user ID by username/displayName/userId")
    .option("--take <n>", "max scanned users (1-500)", "500")
    .option("--exact", "only exact matches")
    .option("--all", "show all matches")
    .option("--id-only", "print only user id(s), one per line")
    .action(
      async (
        query: string,
        options: { take: string; exact?: boolean; all?: boolean; idOnly?: boolean },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora(`Resolving user ID for "${query}"...`).start();
        const take = normalizeTake(options.take);
        const usersList = await api.get<UserListItem[]>("/users", { take });
        const matches = findUserMatches(usersList, query, options.exact === true);
        spinner.stop();

        if (matches.length === 0) {
          throw new Error(
            `No matches for "${query}". Try a larger --take value (up to 500) or run "users list".`,
          );
        }

        if (runtime.json) {
          printJson({
            query,
            scanned: usersList.length,
            matches: matches.map((match) => ({
              userId: match.user.userId,
              username: match.user.username,
              displayName: match.user.displayName ?? null,
              matchedBy: match.matchedBy,
              updatedAt: match.user.updatedAt,
            })),
          });
          return;
        }

        if (options.idOnly) {
          const picked = options.all ? matches : [matches[0]];
          for (const match of picked) {
            console.log(match.user.userId);
          }
          return;
        }

        if (!options.all) {
          const match = matches[0];
          printSuccess(
            `Resolved "${query}" -> ${match.user.userId} (matched by ${match.matchedBy}: ${match.user.username})`,
          );
          return;
        }

        const rows = matches.map((match) => ({
          userId: match.user.userId,
          username: match.user.username,
          displayName: match.user.displayName ?? "-",
          matchedBy: match.matchedBy,
          updatedAt: formatDate(match.user.updatedAt),
        }));
        printTable(rows, [
          { key: "userId", title: "User ID" },
          { key: "username", title: "Username" },
          { key: "displayName", title: "Display Name" },
          { key: "matchedBy", title: "Matched By" },
          { key: "updatedAt", title: "Updated" },
        ]);
      },
    );

  users
    .command("ban <id>")
    .description("Ban a user")
    .requiredOption("--reason <text>")
    .option("--duration <minutes>", "optional temp-ban duration")
    .action(async (id: string, options: { reason: string; duration?: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Banning user ${id}...`).start();
      const payload = {
        reason: options.reason,
        durationMinutes: options.duration ? Number.parseInt(options.duration, 10) : null,
      };
      const result = await api.patch<unknown>(`/users/${id}/ban`, payload);
      spinner.succeed("User banned.");
      printJson(result);
    });

  users
    .command("unban <id>")
    .description("Remove active ban from user")
    .action(async (id: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const profile = await api.get<Record<string, unknown>>(`/users/${id}`);
      const username = extractUsername(profile) ?? id;
      const confirmed = await confirmPrompt(`Unban user ${username}? [y/N]`);
      if (!confirmed) {
        printWarn("Unban cancelled.");
        return;
      }
      const spinner = ora(`Unbanning user ${id}...`).start();
      const result = await api.post<unknown>(`/admin/users/${id}/unban`);
      spinner.succeed("User unbanned.");
      if (runtime.json) {
        printJson(result);
        return;
      }
      printSuccess(`User ${username} unbanned.`);
    });

  users
    .command("mute <id>")
    .description("Mute user for N minutes")
    .requiredOption("--duration <minutes>")
    .action(
      async (
        id: string,
        options: { duration: string },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const minutes = Number.parseInt(options.duration, 10);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          printWarn("duration must be a positive integer.");
          return;
        }

        const spinner = ora(`Muting user ${id}...`).start();
        const result = await api.post<unknown>(`/admin/users/${id}/mute`, {
          duration: minutes,
        });
        spinner.succeed("User muted.");
        if (runtime.json) {
          printJson(result);
          return;
        }
        printSuccess(`User ${id} muted for ${minutes} minutes.`);
      },
    );

  users
    .command("warn <id>")
    .description("Issue warning to user")
    .requiredOption("--reason <text>")
    .action(async (id: string, options: { reason: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Warning user ${id}...`).start();
      const result = await api.post<Record<string, unknown>>(`/admin/users/${id}/warn`, {
        reason: options.reason,
      });
      spinner.succeed("User warned.");
      if (runtime.json) {
        printJson(result);
        return;
      }
      const warnCount = readNumber(result, "warnCount", "warnings", "currentWarnings");
      const warnLimit = readNumber(result, "warnLimit", "maxWarnings", "limit");
      if (warnCount !== null) {
        const suffix = warnLimit !== null ? `${warnCount}/${warnLimit}` : `${warnCount}`;
        printSuccess(`Warnings: ${suffix}`);
        return;
      }
      printSuccess("Warning issued.");
    });

  users
    .command("reset-password <id>")
    .description("Send password reset link to user")
    .action(async (id: string, command: Command) => {
      const confirmed = await confirmPrompt("Send password reset link? [y/N]");
      if (!confirmed) {
        printWarn("Password reset cancelled.");
        return;
      }
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Requesting password reset for ${id}...`).start();
      const result = await api.post<unknown>(`/admin/users/${id}/reset-password`);
      spinner.succeed("Password reset requested.");
      if (runtime.json) {
        printJson(result);
        return;
      }
      printSuccess("Password reset link sent to user's email");
    });

  users
    .command("delete <id>")
    .description("Delete user")
    .option("--confirm", "confirm deletion")
    .action(async (id: string, options: { confirm?: boolean }, command: Command) => {
      if (!options.confirm) {
        throw new Error("Pass --confirm to delete");
      }
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const profile = await api.get<Record<string, unknown>>(`/users/${id}`);
      renderDeleteWarning(profile);
      const spinner = ora(`Deleting user ${id}...`).start();
      const result = await api.delete<unknown>(`/admin/users/${id}`);
      spinner.succeed("User deleted.");
      if (runtime.json) {
        printJson(result);
        return;
      }
      console.log(pc.red("User deleted."));
      printSuccess(`User ${id} deleted.`);
    });

  users
    .command("history <id>")
    .description("Get user moderation history")
    .option("--take <n>", "rows limit", "25")
    .action(async (id: string, options: { take: string }, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Loading user history for ${id}...`).start();
      const result = await api.get<Array<Record<string, unknown>>>(`/admin/users/${id}/history`, {
        take: options.take,
      });
      spinner.succeed(`Loaded ${result.length} entries.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      if (!result.length) {
        printWarn("No results found");
        return;
      }

      printTable(
        result.map((entry) => ({
          date: formatDate(entry.date ?? entry.createdAt ?? entry.timestamp),
          action: entry.action ?? "-",
          reason: entry.reason ?? entry.note ?? "-",
          admin: entry.admin ?? entry.adminId ?? "-",
        })),
        [
          { key: "date", title: "Date" },
          { key: "action", title: "Action" },
          { key: "reason", title: "Reason" },
          { key: "admin", title: "Admin" },
        ],
      );
    });

  users
    .command("notify <id>")
    .description("Send realtime notification to one user")
    .requiredOption("--title <text>")
    .requiredOption("--message <text>")
    .option("--kind <kind>", "notification kind", "info")
    .option("--channel <channelId>", "optional channel id context")
    .option("--metadata <json>", "optional metadata JSON object")
    .action(
      async (
        id: string,
        options: {
          title: string;
          message: string;
          kind: string;
          channel?: string;
          metadata?: string;
        },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const result = await sendLegacyNotificationToUser(runtime, id, options);
        if (runtime.json) {
          printJson(result);
          return;
        }
        printSuccess(`Notification sent to ${id}.`);
      },
    );

  users
    .command("notify-many")
    .description("Send realtime notification to multiple users")
    .requiredOption("--ids <csv>", "comma separated user IDs")
    .requiredOption("--title <text>")
    .requiredOption("--message <text>")
    .option("--kind <kind>", "notification kind", "info")
    .option("--channel <channelId>", "optional channel id context")
    .option("--metadata <json>", "optional metadata JSON object")
    .action(
      async (
        options: {
          ids: string;
          title: string;
          message: string;
          kind: string;
          channel?: string;
          metadata?: string;
        },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const result = await sendLegacyNotificationToMany(runtime, options);
        if (runtime.json) {
          printJson(result);
          return;
        }
        printSuccess("Notifications sent.");
      },
    );

  users
    .command("notify-all")
    .description("Send realtime notification to all users")
    .requiredOption("--title <text>")
    .requiredOption("--message <text>")
    .option("--kind <kind>", "notification kind", "info")
    .option("--channel <channelId>", "optional channel id context")
    .option("--metadata <json>", "optional metadata JSON object")
    .action(
      async (
        options: {
          title: string;
          message: string;
          kind: string;
          channel?: string;
          metadata?: string;
        },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const result = await sendLegacyNotificationToAll(runtime, options);
        if (runtime.json) {
          printJson(result);
          return;
        }
        printSuccess("Notifications sent.");
      },
    );
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

function extractUsername(profile: Record<string, unknown>): string | null {
  const direct = readString(profile, "username", "displayName", "name");
  if (direct) {
    return direct;
  }
  const nested = profile.profile;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return readString(nested as Record<string, unknown>, "username", "displayName", "name");
  }
  return null;
}

function renderDeleteWarning(profile: Record<string, unknown>): void {
  const table = new Table({
    head: [pc.red("Field"), pc.red("Value")],
    wordWrap: true,
    colWidths: [20, 48],
  });

  table.push(
    ["User ID", readString(profile, "userId", "id") ?? "-"],
    ["Username", extractUsername(profile) ?? "-"],
    ["Email", readString(profile, "email") ?? "-"],
    ["Banned", formatBoolean(readBoolean(profile, "isBanned", "banned"))],
    ["Suspicious", formatBoolean(readBoolean(profile, "isSuspicious", "suspicious"))],
  );

  console.log(pc.red("WARNING: This action is irreversible."));
  console.log(table.toString());
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readBoolean(source: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function formatBoolean(value: boolean | null): string {
  if (value === null) {
    return "-";
  }
  return value ? "yes" : "no";
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

function normalizeTake(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 500;
  }
  return Math.max(1, Math.min(parsed, 500));
}

function normalizeLookupValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function findUserMatches(users: UserListItem[], query: string, exactOnly: boolean): UserLookupMatch[] {
  const normalizedQuery = normalizeLookupValue(query);
  if (!normalizedQuery) {
    return [];
  }

  const matches: UserLookupMatch[] = [];
  for (const user of users) {
    const match = matchUser(user, normalizedQuery, exactOnly);
    if (match) {
      matches.push(match);
    }
  }

  matches.sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    return compareIsoDateDesc(left.user.updatedAt, right.user.updatedAt);
  });

  return matches;
}

function matchUser(
  user: UserListItem,
  normalizedQuery: string,
  exactOnly: boolean,
): UserLookupMatch | null {
  const userId = normalizeLookupValue(user.userId);
  const username = normalizeLookupValue(user.username);
  const displayName = normalizeLookupValue(user.displayName);

  if (userId === normalizedQuery) {
    return { user, rank: 0, matchedBy: "userId" };
  }
  if (username === normalizedQuery) {
    return { user, rank: 1, matchedBy: "username" };
  }
  if (displayName && displayName === normalizedQuery) {
    return { user, rank: 2, matchedBy: "displayName" };
  }
  if (exactOnly) {
    return null;
  }

  if (userId.startsWith(normalizedQuery)) {
    return { user, rank: 3, matchedBy: "userId" };
  }
  if (username.startsWith(normalizedQuery)) {
    return { user, rank: 4, matchedBy: "username" };
  }
  if (displayName && displayName.startsWith(normalizedQuery)) {
    return { user, rank: 5, matchedBy: "displayName" };
  }
  if (userId.includes(normalizedQuery)) {
    return { user, rank: 6, matchedBy: "userId" };
  }
  if (username.includes(normalizedQuery)) {
    return { user, rank: 7, matchedBy: "username" };
  }
  if (displayName && displayName.includes(normalizedQuery)) {
    return { user, rank: 8, matchedBy: "displayName" };
  }

  return null;
}

function compareIsoDateDesc(left: string, right: string): number {
  const leftDate = Date.parse(left);
  const rightDate = Date.parse(right);
  const leftSafe = Number.isNaN(leftDate) ? 0 : leftDate;
  const rightSafe = Number.isNaN(rightDate) ? 0 : rightDate;
  return rightSafe - leftSafe;
}
