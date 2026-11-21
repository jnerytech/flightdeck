/**
 * Issue #3499: a shell command read as the program it runs and its arguments, and the Flightdeck CLI
 * as one of those programs. Pure: the risk rules in `risk.ts` ask here what a segment runs.
 */
import { Scan } from "./scan.ts";

/** A prefix assignment (`A=1`, `A+=1`, `A[0]=1`): it comes before the program and is not it. */
const ASSIGNMENT = /^\w+(?:\[[^\]]*\])?\+?=/;

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

/** A word that starts with a brace expansion (`{f..f}d`, `{a,b}`): bash opens a group only with a bare `{`. */
const BRACE_EXPANSION = /^\{[^{}\s]*\}/;

/** A group or a substitution opens the word (`(fd`, `$(fd`, a backtick) or closes it (`on)`, `}`); `{}` is xargs's own. */
const OPENERS = ["$(", "<(", ">(", "(", "{", "`"];
const openerOf = (text: string) => OPENERS.find((opener) => text.startsWith(opener));
const opened = (word: string) => {
  if (word === "{}") return word;
  let rest = word;
  // One opener at a time, so a `(` in front of a brace range does not take the `{` with it (`({f..f}d x)`).
  for (
    let opener = openerOf(rest);
    opener !== undefined && !BRACE_EXPANSION.test(rest);
    opener = openerOf(rest)
  ) {
    rest = rest.slice(opener.length);
  }
  return rest;
};
const CLOSERS = ")}`";
/** The word without the closers at its end; a loop from the end, since a pattern for them backtracks over a long run (#3665). */
const closed = (word: string) => {
  if (word === "{}") return word;
  let end = word.length;
  while (end > 0 && CLOSERS.includes(word[end - 1] as string)) end--;
  return word.slice(0, end);
};

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
  return !words.includes("in") || arm < 0 ? words : words.slice(arm + 1);
}

/** Where the program of a segment starts, past what may come before it: the keywords, groups and wrappers. */
function programStart(words: string[]): { at: number; sudo: boolean; xargs: boolean } {
  let at = 0;
  let sudo = false;
  let xargs = false;
  while (at < words.length) {
    const word = words[at] as string;
    const name = program(word);
    const wrapper = WRAPPERS.get(name);
    if (name === "xargs") xargs = true;
    if (ELEVATORS.has(name)) sudo = true;
    else if (KEYWORDS.has(word) || word === "") {
      // a keyword or a bare group bracket in front of the command: nothing to read
    } else if (ASSIGNMENT.test(word)) {
      at = endOfQuote(words, at);
    } else if (wrapper) {
      at = skipWrapper(words, at, wrapper);
      continue;
    } else break;
    at++;
  }
  return { at, sudo, xargs };
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
  while (positional > 0 && i < words.length && !ASSIGNMENT.test(words[i] as string)) {
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
  /** The line is run by `xargs`, which appends what it reads from its input to the arguments: they may hold a noun or a verb. */
  xargs?: boolean;
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
  while (i < pattern.length) {
    if (pattern.startsWith("[:", i)) {
      const close = pattern.indexOf(":]", i + 2);
      i = close >= 0 ? close + 2 : i + 1;
    } else if (pattern.charAt(i) === "]") return i;
    else i++;
  }
  return -1;
}

/** The glob as tokens: `*`, `?` (a bracket expression is one), or `=` and a character that stands for itself. */
function globTokens(pattern: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    const c = pattern.charAt(i);
    const end = c === "[" ? endOfBrackets(pattern, i) : -1;
    if (end >= 0) {
      tokens.push("?");
      i = end + 1;
    } else {
      tokens.push(c === "*" || c === "?" ? c : `=${c}`);
      i++;
    }
  }
  return tokens;
}

/**
 * Whether the shell's glob `pattern` (`*`, `?`, one bracket expression as one character) may match all of `name`.
 * No RegExp: the classic two-pointer walk takes time in the product of the two lengths, however many `*` it holds.
 */
function globMatches(pattern: string, name: string): boolean {
  const tokens = globTokens(pattern);
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
  // One brace list in the middle of the word, as bash expands it: prefix, each alternative, suffix (`{f,car}d`).
  const group = /^([^{]*)\{([^{}]*)\}(.*)$/.exec(literal);
  const listed = group ? (group[2] as string).split(",").map((a) => group[1] + a + group[3]) : [];
  const candidates =
    literal.includes("{") || literal.includes(",")
      ? [...parts, ...parts.slice(1).map((p) => parts[0] + p), ...listed]
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
export function invocations(segment: string[], scan: Scan = new Scan(), chain = 0): Invocation[] {
  const words = scan.segment(segment, (raw) =>
    withoutRedirections(afterLabel(raw).map(closed).map(opened)).filter((w) => w !== ""),
  );
  if (!words) return [];
  const { at, sudo, xargs } = programStart(words);
  const fed = xargs ? { xargs: true } : {};
  const written = words[at] ?? "";
  const prog = program(written);
  const args = words.slice(at + 1);
  const expanded = /[$*?[{,]/.test(prog) && !BARE_VARIABLE.test(prog) && mayBeCli(prog);
  const hidden = expanded ? { hidden: true } : {};
  if (!prog.includes("$")) {
    if (expanded)
      return [{ prog: "flightdeckd", args, sudo, unresolved: false, ...hidden, ...fed }];
    // Outside quotes a backslash escapes the next character (`f\d` is `fd`), and `program` reads it as a folder:
    // the word without its backslashes is a second reading.
    const escaped = program(written.replaceAll("\\", ""));
    return escaped === prog
      ? [{ prog, args, sudo, unresolved: false, ...fed }]
      : [
          { prog, args, sudo, unresolved: false, ...fed },
          { prog: escaped, args, sudo, unresolved: false, ...fed },
        ];
  }
  const rest = scan.afterVariable(args);
  return [
    { prog: "flightdeckd", args: rest, sudo, unresolved: true, ...hidden, ...fed },
    { prog: "sh", args: rest, sudo, unresolved: true },
    ...(scan.chained(chain)
      ? invocations(rest, scan, chain + 1).map((i) => ({ ...i, sudo: i.sudo || sudo }))
      : []),
  ];
}

/** Quotes and backslashes cut out, as the shell does: `fd "appr"ove` is `fd approve`. */
export const unquoted = (word: string) => word.replace(/["'\\]/g, "").toLowerCase();

/** The options of `fd` that take a value, which can stand before the command (`fd --project p card
 * discard c1`). A test keeps this list equal to the parser's, which this domain cannot import. */
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
  "--max-rounds",
  "--check-timeout-min",
  "--mode",
  "--budget-usd",
  "--max-turns",
  "--max-failures",
  "--daily-usd",
  "--check-rounds",
  "--check-env",
  "--check-loop-default",
  "--drift-allow",
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
  "--map",
  "--side",
  "--lines",
  "--template",
  "--digests",
  "--limit",
  "--out",
  "--from",
  "--to",
  "--cwd",
  "--project-key",
  "--origin",
  "--kind",
  "--path",
  "--file",
  "--expected-hash",
  "--cursor",
  "--folders",
  "--launch",
  "--url",
  "--token",
  "--last",
  "--hours",
  "--days",
  "--team",
  "--with-host",
  "--status",
  "--policy-file",
  "--unpause",
  "--requester",
  "--purpose",
  "--action",
  "--tag",
  "--run",
  "--text",
  "--select",
  "--terminal",
  "--value",
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
  "--automation",
  "--max-runs",
  "--external-authors",
  "--definition-file",
  "--secret-ids",
  "--digest",
  "--branch",
  "--remote",
];
/** The same list, for the lookup: the list stays an array so a test can compare it with the parser's. */
const VALUE_OPTIONS = new Set(OPTIONS_WITH_VALUE);

/** Inside single quotes everything is literal up to the close; an ANSI-C quote lets a backslash escape anything. */
function stepInSingles(open: string, c: string, i: number): { open: string; next: number } {
  if (open === "$'" && c === "\\") return { open, next: i + 2 };
  return { open: c === "'" ? "" : open, next: i + 1 };
}

/**
 * One step of the shell's reading of quotes (#3559): the quote in force after the character at `i` (`"`, `'`, `$'`
 * for an ANSI-C quote, or "" outside one) and where the next step starts. A backslash escapes the next character
 * outside quotes, and inside double quotes only `"`, `\`, `$` and the backtick; single quotes take everything up
 * to their close; an ANSI-C quote lets a backslash escape anything, its own closing quote included.
 */
function stepQuote(open: string, text: string, i: number): { open: string; next: number } {
  const c = text.charAt(i);
  if (open === "'" || open === "$'") return stepInSingles(open, c, i);
  if (c === "\\" && (open === "" || '"\\$`'.includes(text.charAt(i + 1))))
    return { open, next: i + 2 };
  if (open === '"') return { open: c === '"' ? "" : open, next: i + 1 };
  if (c === "$" && text.charAt(i + 1) === "'") return { open: "$'", next: i + 2 };
  return { open: c === '"' || c === "'" ? c : "", next: i + 1 };
}

/** The `&` of `2>&1`, `>&2`, `<&3` and `&>file` is a redirection's, not the end of a command (#3570). */
const inRedirection = (separator: string, text: string, i: number) =>
  separator === "&" && (/[<>]/.test(text.charAt(i - 1)) || text.charAt(i + 1) === ">");

/**
 * The words of `text` as the shell cuts them (#3570): a blank ends a word only outside quotes, and a backslash
 * escapes the blank after it, so `a\ b\  c` is two words. Each word keeps its quotes and backslashes.
 */
export function shellWords(text: string): string[] {
  const words: string[] = [];
  let quote = "";
  let from = -1;
  for (let i = 0; i < text.length; ) {
    const step = stepQuote(quote, text, i);
    if (quote === "" && step.open === "" && step.next === i + 1 && /\s/.test(text.charAt(i))) {
      if (from >= 0) words.push(text.slice(from, i));
      from = -1;
    } else if (from < 0) from = i;
    quote = step.open;
    i = step.next;
  }
  if (from >= 0) words.push(text.slice(from));
  return words;
}

/** `text` cut at each of `separators` (the longest first) that sits outside single and double quotes. */
export function splitOutsideQuotes(text: string, separators: string[]): string[] {
  const parts: string[] = [];
  let quote = "";
  let from = 0;
  for (let i = 0; i < text.length; ) {
    const step = stepQuote(quote, text, i);
    const separator =
      quote === "" && step.open === ""
        ? separators.find((s) => text.startsWith(s, i) && !inRedirection(s, text, i))
        : undefined;
    if (separator === undefined) {
      quote = step.open;
      i = step.next;
      continue;
    }
    parts.push(text.slice(from, i));
    i += separator.length;
    from = i;
  }
  parts.push(text.slice(from));
  return parts;
}

/** Ends a word the shell expands (`$V`, `r*`, `{a,b}`): kept by `readArguments`, tested by `hidesItsVerb`. */
export const EXPANDS = "\u0000";

/** Whether the shell expands the word (a variable, a glob, a brace list, an ANSI-C quote) before the command reads it. */
export const isExpanded = (word: string | undefined): boolean => (word ?? "").includes(EXPANDS);

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
export const VERB_NOUNS = new Set(
  "card history approvers persona team quota budget costs session rules autoapprove plugins project agentcfg ssh watch snippet boardsync review memory runenv automation message mcp changes file action".split(
    " ",
  ),
);

/**
 * Whether the CLI's command or verb is a word the shell expands before it runs (#3559): `$V`, `$'\x72emove'`,
 * `rem[o]ve`, `{remove,list}`. No reading of such a line says which verb it is, so it is read as high risk. The
 * command is checked unless the program itself is unresolved (`$EDITOR $FILE` is anything); the second word only
 * for a command that has verbs, since for the others it is an argument (`fd send $SID hello`).
 * (Braces are already cut off the word by `invocations`, which leaves the comma or the dots of the expansion.)
 * `fed` is a line that `xargs` runs (#3570).
 */
export function hidesItsVerb(args: string[], unresolved: boolean, fed = false): boolean {
  return shellReadings(args).some((own) => {
    const [command, verb] = flightdeckWords(own);
    // Behind `xargs` the words its input gives follow the ones written: a line that stops short of its verb is
    // finished by them (`echo persona remove qa | xargs fd`), or raised by a flag (`echo --force | xargs fd history resume s`,
    // `echo --confirm | xargs fd mcp test p s`).
    const unfinished =
      fed &&
      (command === undefined ||
        (VERB_NOUNS.has(command) && verb === undefined) ||
        (command === "history" && verb === "resume") ||
        (command === "mcp" && verb === "test"));
    return (
      unfinished ||
      (!unresolved && isExpanded(command)) ||
      (VERB_NOUNS.has(command ?? "") && isExpanded(verb))
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
    if (VALUE_OPTIONS.has(arg)) i++;
    else if (!arg.startsWith("-")) words.push(arg);
  }
  return words[0] === "fd" ? words.slice(1) : words;
}

/** Whether the word at `i` of a runner's text starts the CLI: its name, or the `start` script that runs `bin.ts` (`bun start`, `bun run [options] start`, `bun --cwd "my dir" start`: after an option or an expansion that opens the text, whose value is not told apart from the script, #3566, #3718). */
export const startsCli = (words: string[], i: number) =>
  isCliProgram(program(words[i] ?? "")) ||
  (words[i] === "start" &&
    (i === 0 ||
      /(?:^-)|(?:[$`*?[{])/.test(words[0] ?? "") ||
      (words.indexOf("run") + 1 || Infinity) <= i));

/** The programs that can run the CLI for a session: a runtime or a shell given the text. */
export const RUNNERS = ["bun", "bunx", "npx", "node", ...SHELLS];

/** A runner's text read two ways, high when either says so: cut on blanks, and a quoted argument as its shell cuts it (#3712). */
function runnerReadings(args: string[]): string[][] {
  const cut = (a: string) => unquoted(a).split(/\s+/);
  const shell = (a: string) => {
    const dq = /^"([\s\S]*)"$/.exec(a)?.[1]?.replace(/\\(["\\$`])/g, "$1");
    const text = dq ?? /^'([\s\S]*)'$/.exec(a)?.[1];
    return text === undefined ? cut(a) : shellWords(text).map(unquoted);
  };
  return [args.flatMap(cut).filter(Boolean), args.flatMap(shell).filter(Boolean)];
}

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
  // A runner is given the text of a command, not its words, so a word the shell expands (`$X`, `*`, `{a,b}`) is marked
  // here as `readArguments` marks it for the CLI itself: a rule reads it as unknown, not as the word it looks like.
  return runnerReadings(args).some((reading) => {
    const words = reading.map((w) => (/[$`*?[{]/.test(w) ? w + EXPANDS : w));
    return words.some(
      (_, i) =>
        startsCli(words, i) && matches(flightdeckWords(words.slice(i + 1)), words.slice(i + 1)),
    );
  });
}

/** A runner (`bunx fd persona $V qa`, `sh -c 'fd ...'`) given the CLI and a noun or verb the shell expands. */
export const runnerHidesAVerb = (prog: string, args: string[], fed = false) => {
  if (!RUNNERS.includes(prog)) return false;
  return runnerReadings(args).some((words) => {
    const at = words.findIndex((w, i) => startsCli(words, i) && !program(w).includes("$"));
    // Building or testing the entry file does not run it: what follows `bin.ts` in `bun build bin.ts --outfile $OUT`
    // is no command. Run, its words are the CLI's, so a command the shell expands hides it (#3570).
    const runs = !words.slice(0, Math.max(at, 0)).some((w) => w === "build" || w === "test");
    return at >= 0 && hidesItsVerb(words.slice(at + 1), !runs, fed);
  });
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
  // A runner's text that never names the command is no run of it: skip the walk over its CLI starts (#3566).
  if (!isCliProgram(prog) && !args.some((a) => unquoted(a).split(/\s+/).includes(command)))
    return false;
  return runsFlightdeckWords(
    prog,
    args,
    ([first, verb]) => first === command && verbs.includes(verb ?? ""),
  );
}
