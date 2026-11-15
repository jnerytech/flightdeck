import { createHash } from "node:crypto";
import type { Snippet } from "@flightdeck/protocol";
import { hasControl } from "./model.ts";

/** The shells whose history can be imported. */
export type Shell = "bash" | "zsh" | "powershell";

/** The longest command offered as a snippet. */
const MAX_COMMAND = 4000;

const TRIVIAL = new Set([
  "ls",
  "ll",
  "la",
  "cd",
  "pwd",
  "clear",
  "cls",
  "exit",
  "history",
  "true",
  "false",
]);

/** The character that ends a line that goes on in the next one, by shell. */
const CONTINUATION: Partial<Record<Shell, string>> = { zsh: "\\", powershell: "`" };

/**
 * The commands of a history, one entry each. `continuation` is the character that ends a line
 * that goes on in the next one: such an entry is more than one line and is left out.
 */
export function parseHistory(shell: Shell, text: string): string[] {
  const continuation = CONTINUATION[shell] ?? null;
  const commands: string[] = [];
  let skipping = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    if (shell === "bash" && /^#\d+$/.test(line)) continue;
    if (shell === "zsh" && !skipping) line = line.replace(/^: \d+:\d+;/, "");
    const goesOn = continuation !== null && line.endsWith(continuation);
    if (skipping || goesOn) {
      skipping = goesOn;
      continue;
    }
    const command = line.trim();
    if (command !== "") commands.push(command);
  }
  return commands;
}

/** Worth offering as a snippet: one line, plain, and not just `ls` or `cd ..`. */
export function eligible(command: string): boolean {
  if (command.length > MAX_COMMAND || hasControl(command, "\t")) return false;
  const tokens = command.split(/\s+/);
  if (TRIVIAL.has(tokens[0] as string) && tokens.length <= 2) return false;
  return tokens.length >= 2 || command.length >= 8;
}

export const idOf = (command: string) =>
  createHash("sha256").update(command).digest("hex").slice(0, 16);

/** A name for the snippet: the first words of the command, as plain text. */
export function slug(command: string): string {
  const words = command
    .split(/\s+/)
    .slice(0, 3)
    .map((word) => word.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) // NOSONAR: the replace before made every run of other characters one "-", so at most one at each end
    .filter((word) => word !== "");

  return words.join("-").slice(0, 64) || "comando";
}

export interface Entry {
  command: string;
  count: number;
  shells: Shell[];
}

/** A name for a snippet that none of `taken` has: `base`, else `base-2`, `base-3`... */
export function freeName(taken: Snippet[], base: string): string {
  const names = new Set(taken.map((s) => s.name));
  let name = base;
  let n = 2;
  while (names.has(name)) name = `${base.slice(0, 60)}-${n++}`;
  return name;
}
