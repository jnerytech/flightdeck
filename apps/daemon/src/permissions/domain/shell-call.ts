/**
 * Issue #3499: a shell command read as the program it runs and its arguments, and the Flightdeck CLI
 * as one of those programs. Pure: the risk rules in `risk.ts` ask here what a segment runs.
 */
import { trimEndOf, trimStartOf } from "../../kernel/index.ts";

/** What may come before the program and is not it, and how many words each takes after its options. */
interface Wrapper {
  /** Options that take the next word as their value (`timeout -s KILL`). */
  valued: readonly string[];
  /** Words that are not options and still are not the program (`timeout`'s duration). */
  positional: number;
}
const WRAPPERS: Record<string, Wrapper> = {
  command: { valued: [], positional: 0 },
  nohup: { valued: [], positional: 0 },
  time: { valued: ["-f", "-o"], positional: 0 },
  exec: { valued: ["-a"], positional: 0 },
  builtin: { valued: [], positional: 0 },
  setsid: { valued: [], positional: 0 },
  env: { valued: ["-u", "-C", "-S"], positional: 0 },
  xargs: { valued: ["-I", "-n", "-P", "-L", "-s", "-d", "-E", "-a"], positional: 0 },
  timeout: { valued: ["-s", "-k", "--signal", "--kill-after"], positional: 1 },
  nice: { valued: ["-n", "--adjustment"], positional: 0 },
  ionice: { valued: ["-c", "-n", "-p", "-P", "-u"], positional: 0 },
  stdbuf: { valued: ["-i", "-o", "-e"], positional: 0 },
  chrt: { valued: [], positional: 1 },
  taskset: { valued: ["-c"], positional: 1 },
};
/** Words that start a command and are not it: `then fd ...`, `! fd ...`, `{ fd ...`. */
const KEYWORDS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
  "!",
  "{",
  "}",
  "(",
  ")",
]);

/** A word as a program name: no quotes, no folder, no `\` alias escape, no `.exe`, lowercase. */
export const program = (word: string) =>
  (trimEndOf(trimStartOf(word, `"'\\`), `"'`).split(/[\\/]/).at(-1) as string)
    .toLowerCase()
    .replace(/\.exe$/, "");

/** A group or a substitution opens the word (`(fd`, `{`, `$(fd`, a backtick) or closes it (`on)`, `}`). */
const opened = (word: string) => word.replace(/^(?:\$\(|[({`])+/, "");
const closed = (word: string) => word.replace(/[)}`]+$/, "");

/** Where the program of a segment starts, past what may come before it: the keywords, groups and wrappers. */
function programStart(words: string[]): { at: number; sudo: boolean } {
  let at = 0;
  let sudo = false;
  while (at < words.length) {
    const word = words[at] as string;
    const name = program(word);
    if (name === "sudo") sudo = true;
    else if (KEYWORDS.has(word) || word === "") {
      // a keyword or a bare group bracket: nothing to skip over
    } else if (/^\w+=/.test(word)) {
      // an assignment in front of the command
    } else if (WRAPPERS[name]) {
      at = skipWrapper(words, at, WRAPPERS[name] as Wrapper);
      continue;
    } else break;
    at++;
  }
  return { at, sudo };
}

/** The index past a wrapper at `at`: its options, their values and its own words. */
function skipWrapper(words: string[], at: number, wrapper: Wrapper): number {
  let i = at + 1;
  while (i < words.length) {
    const word = words[i] as string;
    if (word === "--") {
      i++;
      break;
    }
    if (!word.startsWith("-") || word === "-") break;
    i += wrapper.valued.includes(word) ? 2 : 1;
  }
  let positional = wrapper.positional;
  while (positional > 0 && i < words.length && !/^\w+=/.test(words[i] as string)) {
    i++;
    positional--;
  }
  return i;
}

/**
 * The program of a segment and its arguments, past `sudo`, `env X=1`, `timeout 5`, a subshell or brace
 * group and the like (#3499). A program that is a variable (`$FD`, `"${BIN}"`) cannot be resolved, so it is
 * read as the Flightdeck CLI: the verbs after it decide, and any other program is no verb.
 */
export function invocation(segment: string[]): { prog: string; args: string[]; sudo: boolean } {
  const words = segment.map((w, i) => (i === segment.length - 1 ? closed(w) : w)).map(opened);
  const { at, sudo } = programStart(words);
  const prog = program(words[at] ?? "");
  return { prog: prog.includes("$") ? "flightdeckd" : prog, args: words.slice(at + 1), sudo };
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
