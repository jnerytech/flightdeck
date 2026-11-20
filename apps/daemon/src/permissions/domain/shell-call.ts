/**
 * Issue #3499: a shell command read as the program it runs and its arguments, and the Flightdeck CLI
 * as one of those programs. Pure: the risk rules in `risk.ts` ask here what a segment runs.
 */
/** What may come before the program and is not it, and how many words each takes after its options. */
interface Wrapper {
  /** Options that take the next word as their value (`timeout -s KILL`). */
  valued: readonly string[];
  /** Words that are not options and still are not the program (`timeout`'s duration). */
  positional: number;
}
const NONE: Wrapper = { valued: [], positional: 0 };
const WRAPPERS = new Map<string, Wrapper>([
  ["command", NONE],
  ["nohup", NONE],
  ["builtin", NONE],
  ["setsid", NONE],
  ["busybox", NONE],
  ["unbuffer", NONE],
  ["time", { valued: ["-f", "-o", "--format", "--output"], positional: 0 }],
  ["exec", { valued: ["-a"], positional: 0 }],
  ["env", { valued: ["-u", "-C", "-P", "--unset", "--chdir", "--default-signal"], positional: 0 }],
  [
    "xargs",
    {
      valued: [
        "-I",
        "-n",
        "-P",
        "-L",
        "-s",
        "-d",
        "-E",
        "-a",
        "--max-args",
        "--max-procs",
        "--arg-file",
        "--delimiter",
        "--max-lines",
        "--max-chars",
        "--eof",
      ],
      positional: 0,
    },
  ],
  ["timeout", { valued: ["-s", "-k", "--signal", "--kill-after"], positional: 1 }],
  ["nice", { valued: ["-n", "--adjustment"], positional: 0 }],
  ["ionice", { valued: ["-c", "-n", "-p", "-P", "-u", "--class", "--classdata"], positional: 0 }],
  ["stdbuf", { valued: ["-i", "-o", "-e"], positional: 0 }],
  ["chrt", { valued: [], positional: 1 }],
  ["taskset", { valued: [], positional: 1 }],
  ["flock", { valued: ["-w", "-E", "--timeout", "--conflict-exit-code"], positional: 1 }],
  ["watch", { valued: ["-n", "-d", "--interval"], positional: 0 }],
  ["strace", { valued: ["-o", "-e", "-p", "-s", "-u", "-E"], positional: 0 }],
]);
/** Programs that run the rest of their line as another command, with other rights (`sudo` is the same). */
const ELEVATORS = new Set(["sudo", "doas"]);
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
  (word.replace(/["']/g, "").split(/[\\/]/).at(-1) as string).toLowerCase().replace(/\.exe$/, "");

/** A group or a substitution opens the word (`(fd`, `$(fd`, a backtick) or closes it (`on)`, `}`); `{}` is xargs's own. */
const opened = (word: string) =>
  word === "{}" ? word : word.replace(/^(?:\$\(|[<>]\(|[({`])+/, "");
const closed = (word: string) => (word === "{}" ? word : word.replace(/[)}`]+$/, ""));

/** The index of the word that closes the quote a word at `at` leaves open (`X="a b"`, `-d ' '`), or `at` itself. */
function endOfQuote(words: string[], at: number): number {
  const word = words[at] as string;
  const quote = ["'", '"'].find((q) => word.split(q).length % 2 === 0);
  if (!quote) return at;
  const close = words.findIndex((w, i) => i > at && w.includes(quote));
  return close < 0 ? at : close;
}

/** A redirection that takes the next word as its target (`>`, `2>>`, `&>`, `<`): both words are no part of the command. */
const REDIRECT_OPERATOR = /^(?:\d*(?:>>?|<|>&)|&>>?)$/;
/** A redirection that is one word (`>/dev/null`, `2>&1`, `<in`), or glued to the program (`fd>/dev/null`). */
const redirectStart = /[<>]/;

/** The words of a segment without its redirections: they come anywhere, even before the program. */
function withoutRedirections(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    if (REDIRECT_OPERATOR.test(word)) i++;
    else if (/^\d*[<>]|^&>/.test(word)) continue;
    else out.push(redirectStart.test(word) ? (word.split(redirectStart)[0] as string) : word);
  }
  return out;
}

/** What follows a function definition (`f() {`, `function f {`) or a `case` arm (`case x in a) cmd`), or the words as they are. */
function afterLabel(words: string[]): string[] {
  const first = program(words[0] ?? "");
  if (first === "function") return words.slice(2);
  if (/^[\w.-]+\(\)\{?$/.test(words[0] ?? "")) return words.slice(1);
  if (first !== "case") return words;
  const arm = words.findIndex((w, i) => i > words.indexOf("in") && w.endsWith(")"));
  return words.indexOf("in") < 0 || arm < 0 ? words : words.slice(arm + 1);
}

/** Where the program of a segment starts, past what may come before it: the keywords, groups and wrappers. */
function programStart(words: string[]): { at: number; sudo: boolean } {
  let at = 0;
  let sudo = false;
  while (at < words.length) {
    const word = words[at] as string;
    const name = program(word);
    const wrapper = WRAPPERS.get(name);
    if (ELEVATORS.has(name)) sudo = true;
    else if (KEYWORDS.has(word) || word === "") {
      // a keyword or a bare group bracket in front of the command: nothing to read
    } else if (/^\w+=/.test(word)) {
      at = endOfQuote(words, at);
    } else if (wrapper) {
      at = skipWrapper(words, at, wrapper);
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
    if (word === "-") i++;
    else if (!word.startsWith("-")) break;
    else i = wrapper.valued.includes(word) ? endOfQuote(words, i + 1) + 1 : i + 1;
  }
  let positional = wrapper.positional;
  while (positional > 0 && i < words.length && !/^\w+=/.test(words[i] as string)) {
    i++;
    positional--;
  }
  return i;
}

/** What one segment runs: the program, its arguments, whether `sudo` is in front, and whether the program is a variable. */
export interface Invocation {
  prog: string;
  args: string[];
  sudo: boolean;
  unresolved: boolean;
}

/** Programs that read or run what a pipe hands them, or text given with `-c`. */
export const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "fish",
  "pwsh",
  "powershell",
  "cmd",
  "su",
  "iex",
  "invoke-expression",
]);

/** A program name that is the Flightdeck CLI, or a variable that may hold it. */
export const isCliProgram = (name: string) =>
  ["fd", "flightdeckd", "bin.ts"].includes(name) || name.includes("$");

/**
 * What a segment runs, past `sudo`, `env X=1`, `timeout 5`, a subshell or brace group, a redirection and the
 * like (#3499). A program that is a variable (`$FD`, `"${BIN}"`) cannot be resolved: it may be the CLI, a shell
 * or a wrapper, so it gives one reading for each, and the rest of the line is read as a command again.
 */
export function invocations(segment: string[]): Invocation[] {
  const words = withoutRedirections(afterLabel(segment).map(closed).map(opened)).filter(
    (w) => w !== "",
  );
  const { at, sudo } = programStart(words);
  const prog = program(words[at] ?? "");
  const args = words.slice(at + 1);
  if (!prog.includes("$")) return [{ prog, args, sudo, unresolved: false }];
  return [
    { prog: "flightdeckd", args, sudo, unresolved: true },
    { prog: "sh", args, sudo, unresolved: true },
    ...invocations(args).map((i) => ({ ...i, sudo: i.sudo || sudo })),
  ];
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

/** The programs that can run the CLI for a session: a runtime or a shell given the text. */
export const RUNNERS = ["bun", "bunx", "npx", "node", ...SHELLS];
