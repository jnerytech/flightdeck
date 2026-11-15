/** How the lock file's holder is read and shown: one plain line per process, never raw file text. */
import type { SlotEnv, SlotHolder } from "./types.ts";

/** Text from a lock or waiter file, or from /proc, kept to one plain line: control characters become spaces. */
export function oneLine(text: string): string {
  // C1 too (#833 review): U+009B is CSI on the terminals that honor it.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}

export function parseHolder(text: string | null): SlotHolder | null {
  if (!text) return null;
  let value: Partial<Record<keyof SlotHolder, unknown>>;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { pid, label, command, startedAt } = value;
  if (typeof pid !== "number" || typeof startedAt !== "number") return null;
  if (typeof label !== "string" || typeof command !== "string") return null;
  return { pid, label, command, startedAt };
}

/** A command of hundreds of test files, cut to one readable line (#236). */
export function clip(command: string): string {
  return oneLine(command.length > 80 ? `${command.slice(0, 80)}…` : command);
}

export function describeHolder(holder: SlotHolder, now: number): string {
  const seconds = Math.max(0, Math.floor((now - holder.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  let held = `${seconds}s`;
  if (minutes >= 60) held = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  else if (minutes > 0) held = `${minutes}m ${seconds % 60}s`;
  // A holder or waiter of hundreds of test files stays one line (#236).
  return `${oneLine(holder.label)}: ${clip(holder.command)} (pid ${holder.pid}, ${held})`;
}

export function waiterPath(env: SlotEnv, pid: number): string {
  return `${env.path}.wait.${pid}`;
}
