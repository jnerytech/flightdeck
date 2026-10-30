import { type DiffLine, toolDiff } from "./diff.ts";
import { trimTrailingSeparators } from "./paths.ts";

/** What an approval shows, by tool: a command, a file with its preview or diff, or plain fields. */
export type ApprovalView =
  | { kind: "bash"; command: string; description: string | null; cwd: string | null }
  | { kind: "file"; path: string; lines: DiffLine[] }
  | { kind: "fields"; entries: Array<[string, string]> };

/** Values are cut here: the card shows what is asked, not whole documents. */
const MAX_VALUE = 200;

const text = (value: unknown) => (typeof value === "string" ? value : null);

/** `path` relative to `cwd` when inside it (either separator), else as it is. */
function relative(path: string, cwd: string | null): string {
  if (!cwd) return path;
  const base = trimTrailingSeparators(cwd);
  const rest = path.slice(base.length);
  return path.startsWith(base) && /^[\\/]/.test(rest) ? rest.slice(1) : path;
}

/** Nested values flattened to `key.sub`, lists joined, long strings cut. */
export function fields(input: Record<string, unknown>, prefix = ""): Array<[string, string]> {
  return Object.entries(input).flatMap(([key, value]): Array<[string, string]> => {
    const name = `${prefix}${key}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return fields(value as Record<string, unknown>, `${name}.`);
    }
    const shown = Array.isArray(value) ? value.map(String).join(", ") : String(value);
    return [[name, shown.length > MAX_VALUE ? `${shown.slice(0, MAX_VALUE)}…` : shown]];
  });
}

/** A long path cut in the middle; the whole one goes in a tooltip. */
export function shortPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep);
  // The drive or root and one folder, then the last two.
  const head = parts.slice(0, parts[0] === "" ? 3 : 2);
  const tail = parts.slice(-2);
  if (parts.length > head.length + tail.length) {
    const cut = `${head.join(sep)}${sep}…${sep}${tail.join(sep)}`;
    if (cut.length <= max) return cut;
  }
  const keep = Math.floor((max - 1) / 2);
  return `${path.slice(0, keep)}…${path.slice(path.length - keep)}`;
}

/**
 * How a request reads for the user: Bash as its command, description and folder; Write and Edit
 * as the file (relative to the session's folder) with its preview or diff; anything else as key
 * and value pairs.
 */
export function approvalView(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string | null,
): ApprovalView {
  const command = text(input.command);
  if (toolName === "Bash" && command !== null) {
    return { kind: "bash", command, description: text(input.description), cwd };
  }
  const lines = toolDiff(toolName, input);
  const path = text(input.file_path);
  if (lines && path !== null) return { kind: "file", path: relative(path, cwd), lines };
  return { kind: "fields", entries: fields(input) };
}
