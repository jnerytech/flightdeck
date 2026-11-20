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

/** A word as a program name: no quotes, no folder, no `\` alias escape, no `.exe`, `.cmd` or `.ps1`, lowercase. */
const program = (word: string) =>
  (word.replace(/["']/g, "").split(/[\\/]/).at(-1) as string)
    .toLowerCase()
    .replace(/\.(exe|cmd|ps1)$/, "");

/** A group or a substitution opens the word (`(fd`, `$(fd`, a backtick) or closes it (`on)`, `}`); `{}` is xargs's own. */
const opened = (word: string) =>
  word === "{}" ? word : word.replace(/^(?:\$\(|[<>]\(|[({`])+/, "");
const closed = (word: string) => (word === "{}" ? word : word.replace(/[)}`]+$/, ""));

/** The index of the word that closes the quote a word at `at` leaves open (`X="a b"`, `-d ' '`), or `at` itself. */
function endOfQuote(words: string[], at: number): number {
  let open = "";
  for (let n = at; n < words.length; n++) {
    const word = words[n] as string;
    for (let i = 0; i < word.length; ) {
      const step = stepQuote(open, word, i);
      open = step.open;
      i = step.next;
    }
    if (open === "") return n === at ? at : n;
  }
  return at;
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
  /** The program word is an expansion that may become the CLI (`f[d]`, `fd${IFS}persona`): what it runs cannot be read. */
  hidden?: boolean;
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

/** The names `scripts/build-daemon.ts` gives the compiled daemon, one per target. */
const COMPILED_CLI = ["linux", "windows"].flatMap((os) =>
  ["x64", "arm64"].map((cpu) => `flightdeckd-${os}-${cpu}`),
);
const CLI_PROGRAMS = ["fd", "flightdeckd", "bin.ts", ...COMPILED_CLI];
/** What a glob may expand to: the names above, and the launchers `program()` strips the suffix of. */
const CLI_FILES = CLI_PROGRAMS.flatMap((name) => ["", ".exe", ".cmd", ".ps1"].map((s) => name + s));

/** The longest program word that `mayBeCli` matches against the CLI's names. */
const MAX_GLOB_WORD = 64;

/** A program word that is one variable, which `invocations` reads as any program (`invocations` cuts the closing brace off `${BIN}`). */
const BARE_VARIABLE = /^\$\{?\w+\}?$/;

/** The end of the bracket expression that opens at `at` (`[ab]`, `[!a-c]`, `[[:lower:]]`), or -1 when it never closes. */
function endOfBrackets(pattern: string, at: number): number {
  let i = at + 1;
  if ("!^".includes(pattern.charAt(i))) i++;
  if (pattern.charAt(i) === "]") i++;
  for (; i < pattern.length; i++) {
    if (pattern.startsWith("[:", i)) {
      const close = pattern.indexOf(":]", i + 2);
      if (close >= 0) i = close + 1;
    } else if (pattern.charAt(i) === "]") return i;
  }
  return -1;
}

/**
 * Whether the shell's glob `pattern` (`*`, `?`, one bracket expression as one character) may match all of `name`.
 * No RegExp: the classic two-pointer walk takes time in the product of the two lengths, however many `*` it holds.
 */
function globMatches(pattern: string, name: string): boolean {
  const tokens: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    const end = c === "[" ? endOfBrackets(pattern, i) : -1;
    if (end < 0) tokens.push(c === "*" || c === "?" ? c : `=${c}`);
    else {
      tokens.push("?");
      i = end;
    }
  }
  let t = 0;
  let n = 0;
  let star = -1;
  let resume = 0;
  while (n < name.length) {
    const token = tokens[t];
    if (token === "*") {
      star = t++;
      resume = n;
    } else if (token === "?" || token === `=${name.charAt(n)}`) {
      t++;
      n++;
    } else if (star >= 0) {
      t = star + 1;
      n = ++resume;
    } else return false;
  }
  while (tokens[t] === "*") t++;
  return t === tokens.length;
}

/**
 * Whether a program word the shell expands (`f[d]`, `fl*htdeckd`, `f{d,d}`, `f{d..d}`, `fd${IFS}persona`) may become
 * the CLI (#3559). A glob or a brace list is matched against the CLI's names; text after a `$` or a brace range is
 * anything, so only what stands before it is. A bracket that never closes is a plain character (`[ -f x ]`).
 */
function mayBeCli(word: string): boolean {
  // The longest CLI file name is under 30 characters. A longer word is matched in time that grows with the square of
  // its length, so one of many brackets or commas could stall the rules: it is read as a CLI it may expand to.
  if (word.length > MAX_GLOB_WORD) return true;
  const range = word.search(/\{[^{}]*\.\./);
  const open = [word.indexOf("$"), range].filter((i) => i >= 0);
  const cut = open.length > 0 ? Math.min(...open) : -1;
  const literal = cut < 0 ? word : word.slice(0, cut);
  const parts = literal.split(/[{},]/);
  const candidates =
    literal.includes("{") || literal.includes(",")
      ? [...parts, ...parts.slice(1).map((p) => parts[0] + p)]
      : [literal];
  return candidates.some((c) => CLI_FILES.some((name) => globMatches(cut < 0 ? c : `${c}*`, name)));
}

/** A program name that is the Flightdeck CLI (source, compiled or launcher), or a variable that may hold it. */
export const isCliProgram = (name: string) => CLI_PROGRAMS.includes(name) || name.includes("$");

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
  const written = words[at] ?? "";
  const prog = program(written);
  const args = words.slice(at + 1);
  const expanded = /[$*?[{,]/.test(prog) && !BARE_VARIABLE.test(prog) && mayBeCli(prog);
  const hidden = expanded ? { hidden: true } : {};
  if (!prog.includes("$")) {
    if (expanded) return [{ prog: "flightdeckd", args, sudo, unresolved: false, ...hidden }];
    // Outside quotes a backslash escapes the next character (`f\d` is `fd`), and `program` reads it as a folder:
    // the word without its backslashes is a second reading.
    const escaped = program(written.replace(/\\/g, ""));
    return escaped === prog
      ? [{ prog, args, sudo, unresolved: false }]
      : [
          { prog, args, sudo, unresolved: false },
          { prog: escaped, args, sudo, unresolved: false },
        ];
  }
  return [
    { prog: "flightdeckd", args, sudo, unresolved: true, ...hidden },
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
export const OPTIONS_WITH_VALUE = [
  "--message",
  "--position",
  "--title",
  "--estimate",
  "--validation-note",
  "--spec-path",
  "--blocked-by",
  "--session",
  "--host",
  "--fingerprint",
  "--alias",
  "--address",
  "--user",
  "--port",
  "--auth",
  "--secret-ref",
  "--jump",
  "--description",
  "--language",
  "--prompt",
  "--up-to",
  "--open",
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
  "--confirm-hash",
  "--accept-command",
  "--base-branch",
  "--pr-provider",
  "--setup-script",
  "--prompt-template",
  "--auto-approve",
  "--default-hours",
  "--persona-subagents",
  "--plugin-scope",
  "--parts",
  "--template",
  "--limit",
  "--out",
  "--from",
  "--to",
  "--cwd",
  "--project-key",
  "--origin",
  "--cursor",
  "--folders",
  "--launch",
  "--url",
  "--token",
  "--last",
  "--hours",
  "--days",
  "--requester",
  "--purpose",
  "--action",
  "--tag",
  "--risk",
  "--approval",
  "--at",
  "--dir",
  "--project",
  "--project-path",
  "--query",
  "--param",
  "--config",
  "--runtime",
  "--period",
  "--window",
  "--limit-usd",
  "--limit-pct",
  "--id",
  "--resume",
  "--cols",
  "--rows",
];

/**
 * One step of the shell's reading of quotes (#3559): the quote in force after the character at `i` (`"`, `'`, `$'`
 * for an ANSI-C quote, or "" outside one) and where the next step starts. A backslash escapes the next character
 * outside quotes, and inside double quotes only `"`, `\`, `$` and the backtick; single quotes take everything up
 * to their close; an ANSI-C quote lets a backslash escape anything, its own closing quote included.
 */
export function stepQuote(open: string, text: string, i: number): { open: string; next: number } {
  const c = text.charAt(i);
  if (open === "'") return { open: c === "'" ? "" : open, next: i + 1 };
  if (open === "$'") {
    if (c === "\\") return { open, next: i + 2 };
    return { open: c === "'" ? "" : open, next: i + 1 };
  }
  if (c === "\\" && (open === "" || '"\\$`'.includes(text.charAt(i + 1))))
    return { open, next: i + 2 };
  if (open === '"') return { open: c === '"' ? "" : open, next: i + 1 };
  if (c === "$" && text.charAt(i + 1) === "'") return { open: "$'", next: i + 2 };
  return { open: c === '"' || c === "'" ? c : "", next: i + 1 };
}

/** Ends a word the shell expands (`$V`, `r*`, `{a,b}`): kept by `readArguments`, tested by `hidesItsVerb`. */
const EXPANDS = "\u0000";

/**
 * Whether the shell expands something in a word as written (#3559): a variable, a command, a glob, a brace list or
 * range, or an ANSI-C quote. Single quotes and an escaped character are literal, and double quotes expand only a
 * variable or a command, so `'a,b'`, `"*.ts"` and `rem\*ove` are plain words.
 */
function expandsInPlace(raw: string): boolean {
  let open = "";
  for (let i = 0; i < raw.length; ) {
    const c = raw.charAt(i);
    const step = stepQuote(open, raw, i);
    if (c !== "\\") {
      if (
        open === "" &&
        ("$`*?[{,".includes(c) || (c === "." && /\w\.\.\w/.test(raw.slice(i - 1, i + 3))))
      )
        return true;
      if (open === '"' && "$`".includes(c)) return true;
    }
    open = step.open;
    i = step.next;
  }
  return false;
}

/**
 * The arguments as the shell hands them over: words inside an open quote are one argument (`--config "/x y/c.json"`),
 * unquoted, and a word the shell expands ends in `EXPANDS`. A word that ends in a `\` escapes the blank after it, and the split on blanks lost how many there were:
 * one makes the next word part of this one, two or more end it. `escapedBlank` picks the reading.
 */
function readArguments(args: string[], escapedBlank: boolean): string[] {
  const words: string[] = [];
  let open = "";
  let current = "";
  let escaped = false;
  for (const arg of args) {
    current = open || escaped ? `${current} ${arg}` : arg;
    escaped = false;
    for (let i = 0; i < arg.length; ) {
      const step = stepQuote(open, arg, i);
      open = step.open;
      escaped = escapedBlank && step.next > arg.length && open === "";
      i = step.next;
    }
    if (!open && !escaped) {
      words.push(unquoted(current) + (expandsInPlace(current) ? EXPANDS : ""));
      current = "";
    }
  }
  if (open || escaped) words.push(unquoted(current) + (expandsInPlace(current) ? EXPANDS : ""));
  return words;
}

/** Every way the shell may have read the arguments: one, or two when a word ends in a `\` outside a quote. */
export function shellReadings(args: string[]): string[][] {
  const joined = readArguments(args, true);
  const separate = readArguments(args, false);
  return joined.length === separate.length ? [joined] : [joined, separate];
}

/** The commands whose second word is a verb the rules read, and not an argument: `fd persona remove`, not `fd send $SID`. */
const VERB_NOUNS = [
  "card",
  "history",
  "approvers",
  "persona",
  "team",
  "quota",
  "budget",
  "costs",
  "session",
  "rules",
  "autoapprove",
  "plugins",
  "project",
];

/**
 * Whether the CLI's command or verb is a word the shell expands before it runs (#3559): `$V`, `$'\x72emove'`,
 * `rem[o]ve`, `{remove,list}`. No reading of such a line says which verb it is, so it is read as high risk. The
 * command is checked unless the program itself is unresolved (`$EDITOR $FILE` is anything); the second word only
 * for a command that has verbs, since for the others it is an argument (`fd send $SID hello`).
 * (Braces are already cut off the word by `invocations`, which leaves the comma or the dots of the expansion.)
 */
export function hidesItsVerb(args: string[], unresolved: boolean): boolean {
  const expands = (word: string | undefined) => (word ?? "").includes(EXPANDS);
  return shellReadings(args).some((own) => {
    const [command, verb] = flightdeckWords(own);
    return (
      (!unresolved && expands(command)) || (VERB_NOUNS.includes(command ?? "") && expands(verb))
    );
  });
}

/** The words of a CLI line that `flightdeckWords` reads: the rules read a noun, a verb and one or two words more. */
const MAX_CLI_WORDS = 6;

/**
 * The words of `fd` or `flightdeckd` that are not options nor an option's value (`--config <file>`, `--json`).
 * The parser reads `flightdeckd fd <command>` as `flightdeckd <command>`, so one leading `fd` is no word (#3566); a
 * second one stays, since the parser sends `fd fd` to claude, and a later one is an argument.
 */
export function flightdeckWords(args: string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < args.length && words.length < MAX_CLI_WORDS; i++) {
    const arg = args[i] as string;
    if (OPTIONS_WITH_VALUE.includes(arg)) i++;
    else if (!arg.startsWith("-")) words.push(arg);
  }
  return words[0] === "fd" ? words.slice(1) : words;
}

/**
 * Whether the word at `i` of a runner's text starts the CLI: its name, or `bun start` or `bun run [options] start`, the script of
 * `apps/daemon/package.json` that runs `bin.ts` (#3566).
 */
export const startsCli = (words: string[], i: number) =>
  isCliProgram(program(words[i] ?? "")) ||
  (words[i] === "start" && (i === 0 || words.slice(0, i).includes("run")));

/** The programs that can run the CLI for a session: a runtime or a shell given the text. */
export const RUNNERS = ["bun", "bunx", "npx", "node", ...SHELLS];

/**
 * Whether a command line runs the CLI with words that `matches` accepts, as the CLI itself, or under a
 * runtime or a shell (`bun bin.ts`, `bash -c`). Each CLI program in the text starts its own command: a
 * word of another command is no verb of it, so `fd send fd-qa "ssh remove"` is not one. `matches` gets the
 * command's words and, as a second argument, its own arguments.
 */
export function runsFlightdeckWords(
  prog: string,
  args: string[],
  matches: (words: string[], own: string[]) => boolean,
): boolean {
  if (isCliProgram(prog))
    return shellReadings(args).some((own) => matches(flightdeckWords(own), own));
  if (!RUNNERS.includes(prog)) return false;
  const words = args.flatMap((a) => unquoted(a).split(/\s+/)).filter(Boolean);
  return words.some(
    (_, i) =>
      startsCli(words, i) && matches(flightdeckWords(words.slice(i + 1)), words.slice(i + 1)),
  );
}

/** A runner (`bunx fd persona $V qa`, `sh -c 'fd ...'`) given the CLI and a noun or verb the shell expands. */
export const runnerHidesAVerb = (prog: string, args: string[]) => {
  if (!RUNNERS.includes(prog)) return false;
  const words = args.flatMap((a) => unquoted(a).split(/\s+/)).filter(Boolean);
  const at = words.findIndex((w, i) => startsCli(words, i) && !program(w).includes("$"));
  // Only a noun that has verbs: what follows `bin.ts` in `bun build bin.ts --outfile $OUT` is no command.
  return at >= 0 && hidesItsVerb(words.slice(at + 1), true);
};

/**
 * A CLI line whose name, noun or verb the reader cannot see (#3559): the shell expands it before it runs. Every
 * rule reads the verb from the words, so a line that hides it would pass as an ordinary shell command; it is
 * high instead.
 */
export const HIDDEN_VERB =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

/**
 * Whether the line runs `<command> <verb>` of the Flightdeck CLI, for one of `verbs`. The verb is read as
 * the word after the command, since a value flag before it (`--language en`) shifts the words.
 */
export function runsCliVerb(
  prog: string,
  args: string[],
  command: string,
  verbs: string[],
): boolean {
  if (isCliProgram(prog)) {
    return shellReadings(args).some((own) => {
      const [first, verb] = flightdeckWords(own);
      return first === command && verbs.includes(verb ?? "");
    });
  }
  if (!RUNNERS.includes(prog)) return false;
  const words = args.flatMap((a) => unquoted(a).split(/\s+/)).filter(Boolean);
  const runsCli = words.some((_, i) => startsCli(words, i));
  return runsCli && words.some((w, i) => w === command && verbs.includes(words[i + 1] ?? ""));
}
