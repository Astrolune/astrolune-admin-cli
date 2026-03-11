import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Command } from "commander";
import { createRuntimeContext, patchConfig, readConfig, stripTrailingSlash } from "../core/config.js";
import { printInfo, printJson, printSuccess, printWarn } from "../core/output.js";
import type { GlobalOptions } from "../core/types.js";

const DEFAULT_AUTH_API_URL = "http://localhost:5001/api/auth";
const DEFAULT_AUTH_BROWSER_URL = "http://localhost:5174/login";
const DEFAULT_CALLBACK_HOST = "127.0.0.1";
const DEFAULT_CALLBACK_PATH = "/callback";
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

type BrowserAuthMode = "login" | "register";

interface LoginCommandOptions {
  register?: boolean;
  authUrl?: string;
  browserUrl?: string;
  timeout?: string;
  open?: boolean;
}

interface BrowserCallbackResult {
  accessToken: string;
  refreshToken: string;
  callbackUrl: string;
  launchUrl: string;
}

interface AuthUserPayload {
  id: string;
  username: string;
  email: string;
  platformRole: string;
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage CLI credentials");

  auth
    .command("login")
    .description("Authenticate via browser callback flow and store admin token")
    .option("--register", "open register flow instead of login")
    .option("--auth-url <url>", "auth API URL (default: http://localhost:5001/api/auth)")
    .option("--browser-url <url>", "browser auth URL (default: http://localhost:5174/login)")
    .option("--timeout <ms>", "callback timeout in ms (default: 300000)")
    .option("--no-open", "do not auto-open browser; print URL for manual open")
    .action(async (options: LoginCommandOptions, command: Command) => {
      const runtime = await createRuntimeContext(command.optsWithGlobals() as GlobalOptions);
      const mode: BrowserAuthMode = options.register ? "register" : "login";
      const authApiUrl = resolveAuthApiUrl(options.authUrl, runtime.authApiUrl);
      const browserUrl = resolveBrowserUrl(mode, options.browserUrl ?? runtime.authBrowserUrl);
      const timeoutMs = parseTimeoutMs(options.timeout, DEFAULT_LOGIN_TIMEOUT_MS);

      const callback = await waitForBrowserCallback({
        mode,
        browserUrl,
        timeoutMs,
        shouldOpenBrowser: options.open !== false,
      });

      const user = await fetchAuthUser(authApiUrl, callback.accessToken, timeoutMs);
      const role = user.platformRole.toLowerCase();

      if (!ADMIN_ROLES.has(role)) {
        await patchConfig({
          token: undefined,
          refreshToken: undefined,
          authApiUrl,
          authBrowserUrl: stripTrailingSlash(browserUrl),
        });
        throw new Error(
          `User "${user.username}" has role "${user.platformRole}". Admin CLI requires "admin" or "super_admin".`,
        );
      }

      await patchConfig({
        token: callback.accessToken,
        refreshToken: callback.refreshToken,
        authApiUrl,
        authBrowserUrl: stripTrailingSlash(browserUrl),
      });

      printSuccess(
        `Authenticated as ${user.username} (${user.email}), role=${user.platformRole}. Token saved.`,
      );

      if ((command.optsWithGlobals() as GlobalOptions).json) {
        printJson({
          ok: true,
          user,
          authApiUrl,
          browserUrl,
          callbackUrl: callback.callbackUrl,
        });
      }
    });

  auth
    .command("set-token <token>")
    .description("Store admin bearer token in local config")
    .action(async (token: string) => {
      await patchConfig({ token });
      printSuccess("Token saved to local config.");
    });

  auth
    .command("clear-token")
    .description("Remove stored token from local config")
    .action(async () => {
      await patchConfig({ token: undefined, refreshToken: undefined });
      printSuccess("Stored tokens removed.");
    });

  const config = program.command("config").description("Manage CLI config");

  config
    .command("set-url <url>")
    .description("Store admin API base URL")
    .action(async (url: string) => {
      await patchConfig({ baseUrl: stripTrailingSlash(url) });
      printSuccess("Base URL updated.");
    });

  config
    .command("set-moderation-url <url>")
    .description("Store moderation API base URL")
    .action(async (url: string) => {
      await patchConfig({ moderationBaseUrl: stripTrailingSlash(url) });
      printSuccess("Moderation base URL updated.");
    });

  config
    .command("set-auth-url <url>")
    .description("Store auth API URL used for browser login verification")
    .action(async (url: string) => {
      await patchConfig({ authApiUrl: stripTrailingSlash(url) });
      printSuccess("Auth API URL updated.");
    });

  config
    .command("set-auth-browser-url <url>")
    .description("Store browser auth login URL used by auth login flow")
    .action(async (url: string) => {
      await patchConfig({ authBrowserUrl: stripTrailingSlash(url) });
      printSuccess("Auth browser URL updated.");
    });

  config
    .command("set-timeout <ms>")
    .description("Store request timeout in milliseconds")
    .action(async (ms: string) => {
      const value = Number.parseInt(ms, 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("timeout must be a positive integer");
      }
      await patchConfig({ timeoutMs: value });
      printSuccess(`Timeout updated to ${value}ms.`);
    });

  config
    .command("show")
    .description("Print current config snapshot")
    .action(async () => {
      const cfg = await readConfig();
      const masked = {
        ...cfg,
        token: cfg.token ? `${cfg.token.slice(0, 6)}...${cfg.token.slice(-4)}` : undefined,
        refreshToken: cfg.refreshToken
          ? `${cfg.refreshToken.slice(0, 6)}...${cfg.refreshToken.slice(-4)}`
          : undefined,
      };
      if (!cfg.token) {
        printWarn("Token is not set.");
      }
      printJson(masked);
    });
}

function parseTimeoutMs(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("timeout must be a positive integer");
  }
  return parsed;
}

function resolveAuthApiUrl(explicit: string | undefined, runtimeValue: string | undefined): string {
  return stripTrailingSlash(explicit ?? runtimeValue ?? DEFAULT_AUTH_API_URL);
}

function resolveBrowserUrl(mode: BrowserAuthMode, explicit: string | undefined): string {
  const base = stripTrailingSlash(explicit ?? DEFAULT_AUTH_BROWSER_URL);
  if (mode === "login") {
    return base;
  }

  try {
    const parsed = new URL(base);
    parsed.pathname = parsed.pathname.replace(/\/login\/?$/i, "/register");
    return parsed.toString();
  } catch {
    return base.replace(/\/login\/?$/i, "/register");
  }
}

function randomState(): string {
  return randomBytes(16).toString("hex");
}

async function waitForBrowserCallback(params: {
  mode: BrowserAuthMode;
  browserUrl: string;
  timeoutMs: number;
  shouldOpenBrowser: boolean;
}): Promise<BrowserCallbackResult> {
  const state = randomState();
  let launchUrl = "";

  return await new Promise<BrowserCallbackResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(
        new Error(
          `Auth callback timed out after ${params.timeoutMs}ms. Complete login in browser and retry.`,
        ),
      );
    }, params.timeoutMs);

    const server = createServer((req, res) => {
      try {
        const incomingUrl = new URL(
          req.url ?? "/",
          `http://${DEFAULT_CALLBACK_HOST}`,
        );
        if (incomingUrl.pathname !== DEFAULT_CALLBACK_PATH) {
          respondHtml(res, 404, "Not Found", "Unknown callback path.");
          return;
        }

        const callbackState = incomingUrl.searchParams.get("state");
        if (callbackState !== state) {
          respondHtml(
            res,
            400,
            "Invalid state",
            "State mismatch. Close this tab and restart auth login.",
          );
          clearTimeout(timeout);
          server.close();
          reject(new Error("Auth callback state mismatch."));
          return;
        }

        const authError = readQueryValue(incomingUrl, ["error", "authError"]);
        if (authError) {
          respondHtml(res, 400, "Authentication failed", authError);
          clearTimeout(timeout);
          server.close();
          reject(new Error(`Auth flow returned error: ${authError}`));
          return;
        }

        const accessToken = readQueryValue(incomingUrl, [
          "accessToken",
          "access_token",
          "token",
          "jwt",
        ]);
        const refreshToken = readQueryValue(incomingUrl, [
          "refreshToken",
          "refresh_token",
          "refresh",
        ]);

        if (!accessToken || !refreshToken) {
          respondHtml(
            res,
            400,
            "Missing tokens",
            "Callback did not include accessToken/refreshToken.",
          );
          clearTimeout(timeout);
          server.close();
          reject(new Error("Callback did not include access token and refresh token."));
          return;
        }

        respondHtml(
          res,
          200,
          "Authentication complete",
          "You can close this tab and return to terminal.",
        );

        clearTimeout(timeout);
        server.close();
        resolve({
          accessToken,
          refreshToken,
          callbackUrl: incomingUrl.toString(),
          launchUrl,
        });
      } catch (error) {
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(0, DEFAULT_CALLBACK_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        clearTimeout(timeout);
        server.close();
        reject(new Error("Failed to resolve callback server address."));
        return;
      }

      const redirectUri = buildRedirectUri(address, state);
      launchUrl = buildAuthLaunchUrl(params.mode, params.browserUrl, redirectUri);
      printInfo(`Auth URL: ${launchUrl}`);

      if (params.shouldOpenBrowser) {
        const opened = tryOpenBrowser(launchUrl);
        if (opened) {
          printInfo("Browser opened for authentication.");
        } else {
          printWarn("Failed to auto-open browser. Open the URL above manually.");
        }
      } else {
        printInfo("Open the auth URL above in browser to continue.");
      }
    });
  });
}

function buildRedirectUri(address: AddressInfo, state: string): string {
  const redirectUrl = new URL(
    `http://${DEFAULT_CALLBACK_HOST}:${address.port}${DEFAULT_CALLBACK_PATH}`,
  );
  redirectUrl.searchParams.set("state", state);
  return redirectUrl.toString();
}

function buildAuthLaunchUrl(mode: BrowserAuthMode, browserUrl: string, redirectUri: string): string {
  const parsed = new URL(browserUrl);
  parsed.searchParams.set("redirect_uri", redirectUri);
  parsed.searchParams.set("mode", mode);
  parsed.searchParams.set("client_id", "astrolune-admin-cli");
  parsed.searchParams.set("platform", "cli");
  return parsed.toString();
}

function readQueryValue(url: URL, keys: string[]): string | null {
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value && value.trim()) {
      return value;
    }
  }
  return null;
}

function respondHtml(
  res: import("node:http").ServerResponse<import("node:http").IncomingMessage>,
  statusCode: number,
  title: string,
  message: string,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      title,
    )}</title></head><body><h2>${escapeHtml(title)}</h2><p>${escapeHtml(
      message,
    )}</p></body></html>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function tryOpenBrowser(url: string): boolean {
  try {
    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    }

    if (process.platform === "darwin") {
      const child = spawn("open", [url], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    }

    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function fetchAuthUser(
  authApiUrl: string,
  accessToken: string,
  timeoutMs: number,
): Promise<AuthUserPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${stripTrailingSlash(authApiUrl)}/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const rawText = await response.text();
    const payload = tryParseJson(rawText);

    if (!response.ok) {
      const reason =
        extractString(payload, "error", "message", "title", "detail") ??
        `HTTP ${response.status} ${response.statusText}`;
      throw new Error(`Failed to validate token via auth/me: ${reason}`);
    }

    const user = normalizeAuthUser(payload);
    if (!user.id) {
      throw new Error("Auth /me response does not include user id.");
    }

    return user;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Auth /me request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAuthUser(payload: unknown): AuthUserPayload {
  const source = toRecord(payload) ?? {};
  const userSource = toRecord(source.user) ?? toRecord(source.User) ?? source;

  const id = extractString(userSource, "id", "Id") ?? "";
  const username = extractString(userSource, "username", "Username") ?? "unknown";
  const email = extractString(userSource, "email", "Email") ?? "unknown";
  const platformRole =
    extractString(userSource, "platformRole", "PlatformRole", "role", "Role") ?? "user";

  return {
    id,
    username,
    email,
    platformRole,
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractString(source: unknown, ...keys: string[]): string | null {
  const record = toRecord(source);
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function tryParseJson(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
