import { URL, URLSearchParams } from "node:url";
import type { RuntimeContext } from "./types.js";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly endpoint?: string;
  readonly method?: string;

  constructor(
    message: string,
    status: number,
    details?: unknown,
    endpoint?: string,
    method?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.endpoint = endpoint;
    this.method = method;
  }
}

export class ApiClient {
  private readonly basePath: string;
  private readonly timeoutMs: number;
  private readonly token?: string;

  constructor(private readonly runtime: RuntimeContext, basePath?: string) {
    this.basePath = stripTrailingSlash(basePath ?? `${runtime.baseUrl}/api/admin/v1`);
    this.timeoutMs = runtime.timeoutMs;
    this.token = runtime.token;
  }

  async get<T>(endpoint: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>("GET", endpoint, { query });
  }

  async post<T>(endpoint: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", endpoint, { body, query });
  }

  async patch<T>(endpoint: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>("PATCH", endpoint, { body, query });
  }

  async delete<T>(endpoint: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>("DELETE", endpoint, { query });
  }

  async deleteWithBody<T>(
    endpoint: string,
    body?: unknown,
    query?: Record<string, unknown>,
  ): Promise<T> {
    return this.request<T>("DELETE", endpoint, { body, query });
  }

  private async request<T>(
    method: string,
    endpoint: string,
    options: {
      body?: unknown;
      query?: Record<string, unknown>;
    },
  ): Promise<T> {
    const url = new URL(`${this.basePath}${endpoint}`);
    const query = toQuery(options.query);
    if (query) {
      url.search = query.toString();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let responseStatus: number | null = null;
    let logged = false;
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = tryParseJson(text);
      responseStatus = response.status;

      if (method !== "GET") {
        logged = await logAudit(this.runtime, method, endpoint, response.status);
      }

      if (!response.ok) {
        throw new ApiError(
          `HTTP ${response.status} ${response.statusText}`,
          response.status,
          payload ?? text,
          endpoint,
          method,
        );
      }

      return (payload as T) ?? ({} as T);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (method !== "GET" && !logged) {
        await logAudit(this.runtime, method, endpoint, responseStatus ?? "network_error");
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toQuery(query?: Record<string, unknown>): URLSearchParams | null {
  if (!query) {
    return null;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item));
        }
      }
      continue;
    }
    params.append(key, String(value));
  }
  return params;
}

function tryParseJson(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

async function logAudit(
  runtime: RuntimeContext,
  method: string,
  endpoint: string,
  responseStatus: number | string,
): Promise<boolean> {
  try {
    const { getAuditContext, extractAdminIdFromToken, writeAuditLog } = await import(
      "../utils/audit.js"
    );
    const context = getAuditContext();
    const adminId = extractAdminIdFromToken(runtime.token);
    await writeAuditLog({
      timestamp: new Date().toISOString(),
      command: context.command ?? "unknown",
      args: context.args ?? [],
      adminId,
      response_status: responseStatus,
    });
    return true;
  } catch {
    return false;
  }
}
