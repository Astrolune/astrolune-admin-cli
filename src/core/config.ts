import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { GlobalOptions, PersistedConfig, RuntimeContext } from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:5007";
const DEFAULT_AUTH_API_URL = "http://localhost:5001/api/auth";
const DEFAULT_AUTH_BROWSER_URL = "http://localhost:5174/login";
const DEFAULT_TIMEOUT_MS = 10_000;

function getConfigPath(): string {
  const root = process.env.ASTROLUNE_ADMIN_CONFIG_DIR ?? path.join(os.homedir(), ".astrolune");
  return path.join(root, "admin-cli.json");
}

export async function readConfig(): Promise<PersistedConfig> {
  const filePath = getConfigPath();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedConfig;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export async function writeConfig(next: PersistedConfig): Promise<void> {
  const filePath = getConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function patchConfig(patch: Partial<PersistedConfig>): Promise<PersistedConfig> {
  const current = await readConfig();
  const next: PersistedConfig = {
    ...current,
    ...patch,
  };
  await writeConfig(next);
  return next;
}

export async function createRuntimeContext(options: GlobalOptions): Promise<RuntimeContext> {
  const persisted = await readConfig();
  const baseUrl = stripTrailingSlash(
    options.url ?? process.env.ASTROLUNE_ADMIN_URL ?? persisted.baseUrl ?? DEFAULT_BASE_URL,
  );
  const token = options.token ?? process.env.ASTROLUNE_ADMIN_TOKEN ?? persisted.token;
  const refreshToken = process.env.ASTROLUNE_ADMIN_REFRESH_TOKEN ?? persisted.refreshToken;
  const authApiUrl = stripTrailingSlash(
    process.env.ASTROLUNE_AUTH_API_URL ?? persisted.authApiUrl ?? inferAuthApiUrl(baseUrl),
  );
  const authBrowserUrl = stripTrailingSlash(
    process.env.ASTROLUNE_AUTH_BROWSER_URL ?? persisted.authBrowserUrl ?? DEFAULT_AUTH_BROWSER_URL,
  );
  const timeoutMs = resolveTimeoutMs(options.timeout, persisted.timeoutMs);

  return {
    baseUrl,
    token,
    refreshToken,
    authApiUrl,
    authBrowserUrl,
    json: Boolean(options.json),
    timeoutMs,
  };
}

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

function resolveTimeoutMs(cliValue: string | undefined, configTimeout: number | undefined): number {
  if (cliValue) {
    const parsed = Number.parseInt(cliValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (typeof configTimeout === "number" && Number.isFinite(configTimeout) && configTimeout > 0) {
    return configTimeout;
  }
  return DEFAULT_TIMEOUT_MS;
}

function inferAuthApiUrl(adminBaseUrl: string): string {
  try {
    const parsed = new URL(adminBaseUrl);
    if (parsed.port === "5007") {
      parsed.port = "5001";
    }
    return `${parsed.origin}/api/auth`;
  } catch {
    return DEFAULT_AUTH_API_URL;
  }
}
