export function renderBox(
  lines: string[],
  options?: {
    padding?: number;
    color?: (value: string) => string;
    title?: string;
  },
): string {
  const padding = options?.padding ?? 1;
  const safeLines = lines.length ? lines : [""];
  const contentWidth = Math.max(...safeLines.map((line) => line.length));
  const width = contentWidth + padding * 2;

  const topLabel = options?.title ? ` ${options.title} ` : "";
  const top = `+${topLabel}${"-".repeat(Math.max(0, width - topLabel.length))}+`;
  const bottom = `+${"-".repeat(width)}+`;

  const rendered = [
    top,
    ...safeLines.map((line) => {
      const padded = `${" ".repeat(padding)}${line}${" ".repeat(
        Math.max(0, width - padding * 2 - line.length),
      )}${" ".repeat(padding)}`;
      return `|${padded}|`;
    }),
    bottom,
  ];

  if (options?.color) {
    return rendered.map((line) => options.color!(line)).join("\n");
  }
  return rendered.join("\n");
}
