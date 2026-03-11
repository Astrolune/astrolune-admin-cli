import os from "node:os";
import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

type AuditContext = {
  command?: string;
  args?: string[];
};

let currentContext: AuditContext = {};

export function setAuditContext(context: AuditContext): void {
  currentContext = context;
}

export function getAuditContext(): AuditContext {
  return currentContext;
}

export async function writeAuditLog(entry: {
  timestamp: string;
  command: string;
  args: string[];
  adminId?: string;
  response_status: number | string;
}): Promise<void> {
  try {
    const filePath = getAuditLogPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Ignore audit logging failures.
  }
}

export function extractAdminIdFromToken(token?: string): string | undefined {
  if (!token) {
    return undefined;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const direct =
      readString(payload, "adminId", "userId", "id", "sub") ?? readString(payload, "uid");
    if (direct) {
      return direct;
    }
    const user = payload.user;
    if (user && typeof user === "object" && !Array.isArray(user)) {
      return readString(user as Record<string, unknown>, "id", "userId", "adminId") ?? undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function getAuditLogPath(): string {
  return path.join(os.homedir(), ".astrolune", "audit.log");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
  return Buffer.from(padded, "base64").toString("utf8");
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
