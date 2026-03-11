import type { Command } from "commander";
import ora from "ora";
import { createRuntimeContext, readConfig } from "../core/config.js";
import { ApiClient } from "../core/http.js";
import { printInfo, printSuccess, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Validate local CLI config and API connectivity")
    .action(async (_, command: Command) => {
      const config = await readConfig();
      if (!config.baseUrl) {
        printWarn("Base URL is not stored. Using default http://localhost:5007.");
      } else {
        printSuccess(`Base URL: ${config.baseUrl}`);
      }

      if (!config.moderationBaseUrl) {
        printWarn("Moderation base URL is not stored. Using default http://localhost:5008.");
      } else {
        printSuccess(`Moderation base URL: ${config.moderationBaseUrl}`);
      }

      if (!config.token && !process.env.ASTROLUNE_ADMIN_TOKEN && !(command.optsWithGlobals() as GlobalOptions).token) {
        printWarn("Token is not configured. Requests requiring auth will fail.");
      } else {
        printSuccess("Token found in config/env/CLI options.");
      }

      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      printInfo(`Active endpoint: ${runtime.baseUrl}`);
      printInfo(`Moderation endpoint: ${runtime.moderationBaseUrl}`);
      printInfo(`Timeout: ${runtime.timeoutMs}ms`);

      const api = new ApiClient(runtime);
      const spinner = ora("Checking /health endpoint...").start();
      await api.get("/health");
      spinner.succeed("Connectivity check passed.");
    });
}
