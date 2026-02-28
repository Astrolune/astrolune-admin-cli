import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printSuccess, printTable, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";

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
      const spinner = ora(`Unbanning user ${id}...`).start();
      const result = await api.delete<unknown>(`/users/${id}/ban`);
      spinner.succeed("User unbanned.");
      printJson(result);
    });

  users
    .command("mute <id>")
    .description("Mute user for N minutes")
    .requiredOption("--reason <text>")
    .requiredOption("--minutes <n>")
    .option("--level <level>", "mute level", "standard")
    .action(
      async (
        id: string,
        options: { reason: string; minutes: string; level: string },
        command: Command,
      ) => {
        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const minutes = Number.parseInt(options.minutes, 10);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          printWarn("minutes must be a positive integer.");
          return;
        }

        const spinner = ora(`Muting user ${id}...`).start();
        const result = await api.patch<unknown>(`/users/${id}/mute`, {
          reason: options.reason,
          durationMinutes: minutes,
          level: options.level,
        });
        spinner.succeed("User muted.");
        printJson(result);
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
      const result = await api.patch<unknown>(`/users/${id}/warn`, {
        reason: options.reason,
      });
      spinner.succeed("User warned.");
      printJson(result);
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
        const api = new ApiClient(runtime);
        const spinner = ora(`Sending notification to ${id}...`).start();
        const result = await api.post<unknown>(`/users/${id}/notify`, {
          title: options.title,
          message: options.message,
          kind: options.kind,
          channelId: options.channel || null,
          metadata: parseJsonOption(options.metadata),
        });
        spinner.succeed("Notification sent.");
        printJson(result);
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
        const userIds = options.ids
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        if (userIds.length === 0) {
          throw new Error("ids must include at least one user id");
        }

        const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
        const api = new ApiClient(runtime);
        const spinner = ora(`Sending notification to ${userIds.length} users...`).start();
        const result = await api.post<unknown>("/users/notify", {
          userIds,
          title: options.title,
          message: options.message,
          kind: options.kind,
          channelId: options.channel || null,
          metadata: parseJsonOption(options.metadata),
        });
        spinner.succeed("Notifications sent.");
        printJson(result);
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
        const api = new ApiClient(runtime);
        const spinner = ora("Sending notification to all users...").start();
        const result = await api.post<unknown>("/users/notify-all", {
          title: options.title,
          message: options.message,
          kind: options.kind,
          channelId: options.channel || null,
          metadata: parseJsonOption(options.metadata),
        });
        spinner.succeed("Notifications sent.");
        printJson(result);
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

function parseJsonOption(value: string | undefined): Record<string, unknown> | null {
  if (!value || !value.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("--metadata must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--metadata must be a JSON object");
  }

  return parsed as Record<string, unknown>;
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
