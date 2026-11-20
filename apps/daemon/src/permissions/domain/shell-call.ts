/**
 * Issue #3499: a shell command read as the program it runs and its arguments, and the Flightdeck CLI
 * as one of those programs. Pure: the risk rules in `risk.ts` ask here what a segment runs.
 */
import { trimEndOf, trimStartOf } from "../../kernel/index.ts";

/** What may come before the program and is not it. */
const PREFIXES = new Set(["command", "nohup", "time", "exec", "builtin", "env", "xargs"]);

/** A word as a program name: no quotes, no folder, no `\` alias escape, no `.exe`, lowercase. */
export const program = (word: string) =>
  (trimEndOf(trimStartOf(word, `"'\\`), `"'`).split(/[\\/]/).at(-1) as string)
    .toLowerCase()
    .replace(/\.exe$/, "");

/** The program of a segment and its arguments, past `sudo`, `env X=1` and the like. */
export function invocation(segment: string[]): { prog: string; args: string[]; sudo: boolean } {
  let i = 0;
  let sudo = false;
  while (i < segment.length) {
    const word = program(segment[i] as string);
    if (word === "sudo") sudo = true;
    else if (!PREFIXES.has(word) && !/^\w+=/.test(segment[i] as string)) break;
    i++;
  }
  return { prog: program(segment[i] ?? ""), args: segment.slice(i + 1), sudo };
}

/** Quotes and backslashes cut out, as the shell does: `fd "appr"ove` is `fd approve`. */
export const unquoted = (word: string) => word.replace(/["'\\]/g, "").toLowerCase();

/**
 * The options of `fd` that take a value, which can stand before the command (`fd --project p card
 * discard c1`). A test keeps this list equal to the parser's, which this domain cannot import.
 */
const OPTIONS_WITH_VALUE = [
  "--message",
  "--position",
  "--title",
  "--estimate",
  "--validation-note",
  "--spec-path",
  "--blocked-by",
  "--session",
  "--host",
  "--description",
  "--language",
  "--workflow",
  "--variant",
  "--workers",
  "--worker",
  "--coordinator",
  "--check",
  "--goal",
  "--persona",
  "--rounds",
  "--max-parallel-runs",
  "--scope",
  "--name",
  "--body",
  "--body-file",
  "--model",
  "--effort",
  "--tools",
  "--permission-mode",
  "--icon",
  "--hash",
  "--limit",
  "--out",
  "--from",
  "--to",
  "--cwd",
  "--project-key",
  "--origin",
  "--cursor",
  "--limit",
  "--folders",
  "--launch",
  "--url",
  "--token",
  "--last",
  "--project",
  "--project-path",
  "--query",
  "--param",
  "--config",
  "--runtime",
];

/** The arguments as the shell hands them over: words inside an open quote are one argument (`--config "/x y/c.json"`), unquoted. */
export function shellArguments(args: string[]): string[] {
  const out: string[] = [];
  let open = "";
  let current = "";
  for (const arg of args) {
    current = open ? `${current} ${arg}` : arg;
    for (const ch of arg) {
      if (ch === open) open = "";
      else if (!open && (ch === '"' || ch === "'")) open = ch;
    }
    if (!open) {
      out.push(unquoted(current));
      current = "";
    }
  }
  if (open) out.push(unquoted(current));
  return out;
}

/** The words of `fd` or `flightdeckd` that are not options nor an option's value (`--config <file>`, `--json`). */
export function flightdeckWords(args: string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (OPTIONS_WITH_VALUE.includes(arg)) i++;
    else if (!arg.startsWith("-")) words.push(arg);
  }
  return words;
}

/** The programs that can run the CLI for a session: itself, a runtime or a shell given the text. */
export const RUNNERS = [
  "bun",
  "bunx",
  "npx",
  "node",
  "sh",
  "bash",
  "zsh",
  "dash",
  "pwsh",
  "powershell",
];
