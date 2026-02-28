import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { formatDate, printJson, printTable } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";

interface ServiceHealthItem {
  service?: string;
  status?: string;
  payload?: unknown;
  error?: string;
}

export function registerHealthCommands(program: Command): void {
  program
    .command("health")
    .description("Check health of aggregated platform services")
    .action(async (_, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const api = new ApiClient(runtime);
      const spinner = ora("Requesting health snapshot...").start();
      const data = await api.get<ServiceHealthItem[]>("/health");
      spinner.succeed("Health snapshot received.");

      if (runtime.json) {
        printJson(data);
        return;
      }

      const rows = data.map((item) => ({
        service: item.service ?? "-",
        status: item.status ?? "-",
        info: item.error ?? item.payload ?? "-",
        checkedAt: formatDate(new Date().toISOString()),
      }));

      printTable(rows, [
        { key: "service", title: "Service" },
        { key: "status", title: "Status" },
        { key: "info", title: "Details" },
        { key: "checkedAt", title: "Checked At" },
      ]);
    });
}
