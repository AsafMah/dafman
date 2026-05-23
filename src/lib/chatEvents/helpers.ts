export const TOOL_OUTPUT_CAP_BYTES = 64 * 1024;

export function clampOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_CAP_BYTES) return text;
  const head = text.slice(0, TOOL_OUTPUT_CAP_BYTES);
  return `${head}\n... [output truncated: ${text.length - TOOL_OUTPUT_CAP_BYTES} more bytes]`;
}

export function pickString(data: unknown, keys: readonly string[]): string {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string") return v;
  }
  return "";
}

export function pickNumber(
  data: unknown,
  keys: readonly string[],
): number | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}
