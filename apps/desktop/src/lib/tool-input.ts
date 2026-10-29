import { fields } from "./approval.ts";

const SUMMARY_KEYS = ["file_path", "command", "pattern", "path", "url", "description"];

/** One line about a tool input: its most telling field, or key and value pairs, cut at 80. */
export function inputSummary(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const key = SUMMARY_KEYS.find((k) => typeof record[k] === "string");
  const text = key
    ? String(record[key])
    : fields(record)
        .map(([name, value]) => `${name}: ${value}`)
        .join(" · ");
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
