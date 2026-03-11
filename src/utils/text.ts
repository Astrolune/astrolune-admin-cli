export function truncateText(value: string, maxLength: number): { text: string; truncated: boolean } {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  if (maxLength <= 3) {
    return { text: value.slice(0, maxLength), truncated: true };
  }
  return { text: `${value.slice(0, maxLength - 3)}...`, truncated: true };
}

export function isIsoDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && value.includes("T");
}
