import type { Command } from "commander";
import ora from "ora";
import pc from "picocolors";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printTable, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";
import { renderBox } from "../utils/box.js";

if (process.env.NODE_ENV === "production") {
  console.error("fun commands are not available in production");
  process.exit(1);
}

export function registerFunCommands(program: Command): void {
  const fun = program.command("fun").description("Playful admin insights");

  fun
    .command("stats <userId>")
    .description("Show fun stats for a user")
    .action(async (userId: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Loading fun stats for ${userId}...`).start();
      const result = await api.get<Record<string, unknown>>(`/admin/fun/stats/${userId}`);
      spinner.succeed("Fun stats ready.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      const lines = [
        `Most active hour: ${result.mostActiveHour ?? result.activeHour ?? "-"}`,
        `Favorite words: ${formatList(result.favoriteWords ?? result.topWords)}`,
        `Total messages / posts: ${formatTotals(result)}`,
        `Assigned title: ${result.title ?? result.assignedTitle ?? "-"}`,
      ];
      console.log(renderBox(lines, { title: "Astrolune Wrapped" }));
    });

  fun
    .command("roast <userId>")
    .description("Show a playful roast")
    .action(async (userId: string, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora(`Fetching roast for ${userId}...`).start();
      const result = await api.get<Record<string, unknown>>(`/admin/fun/roast/${userId}`);
      spinner.succeed("Roast ready.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      const roast = String(result.roast ?? result.message ?? "No roast generated.");
      console.log(renderBox([roast], { color: pc.yellow, title: "Roast" }));
    });

  fun
    .command("leaderboard")
    .description("Top chaotic users leaderboard")
    .action(async (_, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Loading leaderboard...").start();
      const result = await api.get<Array<Record<string, unknown>>>("/admin/fun/leaderboard");
      spinner.succeed(`Loaded ${result.length} users.`);

      if (runtime.json) {
        printJson(result);
        return;
      }

      if (!result.length) {
        printWarn("No results found");
        return;
      }

      printTable(
        result.slice(0, 10).map((item, index) => ({
          rank: formatRank(index + 1),
          username: item.username ?? item.user ?? item.name ?? "-",
          chaos: item.chaosScore ?? item.score ?? "-",
          title: item.memeTitle ?? item.title ?? "-",
        })),
        [
          { key: "rank", title: "Rank" },
          { key: "username", title: "Username" },
          { key: "chaos", title: "Chaos Score" },
          { key: "title", title: "Meme Title" },
        ],
      );
    });

  fun
    .command("weather")
    .description("Platform weather forecast")
    .action(async (_, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Fetching platform weather...").start();
      const result = await api.get<Record<string, unknown>>("/admin/fun/weather");
      spinner.succeed("Weather ready.");

      if (runtime.json) {
        printJson(result);
        return;
      }

      const status = String(result.status ?? result.condition ?? "Clear");
      const detail =
        String(result.detail ?? result.message ?? `Updated ${formatDate(new Date().toISOString())}`);
      console.log(`🌩 ${status} — ${detail}`);
    });
}

function formatList(value: unknown): string {
  if (Array.isArray(value)) {
    return value.slice(0, 3).map(String).join(", ") || "-";
  }
  if (typeof value === "string") {
    return value;
  }
  return "-";
}

function formatTotals(result: Record<string, unknown>): string {
  const messages = result.totalMessages ?? result.messages ?? "-";
  const posts = result.totalPosts ?? result.posts ?? "-";
  return `${messages} / ${posts}`;
}

function formatRank(rank: number): string {
  if (rank === 1) {
    return `1 🏆`;
  }
  if (rank === 2) {
    return `2 🏆`;
  }
  if (rank === 3) {
    return `3 🏆`;
  }
  return String(rank);
}
