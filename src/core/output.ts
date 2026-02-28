import Table from "cli-table3";
import pc from "picocolors";

export function printBanner(): void {
  console.log(pc.cyan("ASTROLUNE ADMIN CLI"));
  console.log(pc.dim("Secure operations for admin-api-service"));
  console.log("");
}

export function printSuccess(message: string): void {
  console.log(`${pc.green("OK")} ${message}`);
}

export function printInfo(message: string): void {
  console.log(`${pc.blue("INFO")} ${message}`);
}

export function printWarn(message: string): void {
  console.log(`${pc.yellow("WARN")} ${message}`);
}

export function printError(message: string): void {
  console.error(`${pc.red("ERROR")} ${message}`);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function printTable(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; title: string }>,
): void {
  if (!rows.length) {
    printWarn("No data.");
    return;
  }

  const table = new Table({
    head: columns.map((column) => pc.cyan(column.title)),
    wordWrap: true,
    colWidths: columns.map((column) => inferWidth(rows, column.key, column.title)),
  });

  for (const row of rows) {
    table.push(columns.map((column) => formatCell(row[column.key])));
  }

  console.log(table.toString());
}

export function formatDate(value: unknown): string {
  if (!value || typeof value !== "string") {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toISOString().replace("T", " ").replace(".000Z", "Z");
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function inferWidth(rows: Array<Record<string, unknown>>, key: string, title: string): number {
  const maxValueLength = rows.reduce((max, row) => {
    const length = formatCell(row[key]).length;
    return Math.max(max, length);
  }, title.length);
  return Math.min(Math.max(maxValueLength + 2, 14), 48);
}
