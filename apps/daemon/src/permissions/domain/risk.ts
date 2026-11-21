/**
 * Phase 13: the risk of a permission request, low, medium or high, by declared rules and no AI.
 * Every rule that applies is a candidate and the highest wins, so `risk.extraHigh` only adds.
 * Anything the rules do not know is medium, never low.
 */
import { join, resolve } from "node:path";
import { isInside } from "../../kernel/index.ts";
import { credential } from "./sensitive-paths.ts";
import {
  flightdeckWords,
  HIDDEN_VERB,
  hidesItsVerb,
  type Invocation,
  invocations,
  isCliProgram,
  RUNNERS,
  runnerHidesAVerb,
  runsCliVerb,
  runsFlightdeckWords,
  SHELLS,
  shellReadings,
  startsCli,
  stepQuote,
  unquoted,
} from "./shell-call.ts";
import { enablesTerminals, opensATerminal } from "./terminal-risk.ts";
import { changesAWatch } from "./watch-risk.ts";

export { credential };

export type RiskLevel = "low" | "medium" | "high";

export interface Risk {
  level: RiskLevel;
  reason: string;
  /** The tool reaches the network: never approved automatically. */
  network: boolean;
}

export interface RiskOptions {
  allowedRoots: readonly string[];
  /** The user's home, for `~` and the credential paths. */
  home: string;
  /** Regexes of shell commands that are high on top of the built-in rules (`risk.extraHigh`). */
  extraHigh?: readonly string[];
}

/** Whether a `risk.extraHigh` pattern compiles. */
export function validRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

export const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

type Candidate = [RiskLevel, string];

export const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
export const READ_TOOLS: Record<string, string[]> = {
  Read: ["file_path"],
  Glob: ["path"],
  Grep: ["path"],
  LS: ["path"],
};
export const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
export const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch"]);

/** Programs that talk to the network (beyond the spec: they never go automatic either). */
const NETWORK_PROGRAMS = new Set([
  "curl",
  "wget",
  "invoke-webrequest",
  "iwr",
  "invoke-restmethod",
  "irm",
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "nc",
  "ncat",
  "telnet",
  "ftp",
]);
/** Redirection targets that go nowhere. */
const SINKS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "nul", "$null"]);

/** One shell word: escaped characters, quoted parts and bare characters, glued together (#2496). */
const SHELL_WORD = String.raw`(?:\\.?|"[^"]*"|'[^']*'|[^\s;&|<>\\])+`;
/** `>`, `>>`, `&>`, `&>>`, `<>`, with a descriptor digit before the `>` (`2>`). */
const REDIRECT_OPERATOR = String.raw`&?\d?(?:>{1,2}|<>)`;
/**
 * A redirect: the operator, an optional `&` or `|` (`>&file`, `>|file`), then its target word. The
 * lookbehind (not a consumed character) lets a second adjacent redirect, `a>b>c`, match too, unless
 * the `>` before it is escaped.
 */
const REDIRECT = new RegExp(
  String.raw`(?<!(?<!\\)[<>])${REDIRECT_OPERATOR}([&|])?\s*(${SHELL_WORD})`,
  "g",
);

/** Phase 39: OpenCode's global folder (`~/.config/opencode`): a plugin written there runs code. */
function opencodeConfig(text: string): boolean {
  const parts = text.toLowerCase().replaceAll("\\", "/").split("/");
  return parts.some((p, i) => p === ".config" && parts[i + 1] === "opencode");
}

/**
 * Phase 40: the same test under the name the assistant's repo context uses (fase-39 exports
 * `credential` itself; both names stay, so the two phases merge without a conflict).
 */
export { credential as isCredentialPath };

/** The words of a command, without quotes, split also where a path cannot go on. */
const words = (command: string) => command.split(/[\s"'`;|&<>()=,]+/).filter((w) => w !== "");

/**
 * A backslash before a newline is a line continuation: bash reads the two lines as one (`.e\<LF>nv`
 * is `.env`). An escaped backslash, `\\<LF>`, is not one. This is a second reading, never a
 * replacement: a comment, `\<CR><LF>` and PowerShell end the line, so the text as written is judged
 * too (#2496).
 */
function joinContinuations(command: string): string {
  return command.replace(/(?<!\\)((?:\\\\)*)\\\r?\n/g, "$1");
}

/** Separate commands (`;`, `&&`, `||`, `|`, `&`, newlines), each as its words. */
function segments(command: string): string[][] {
  return command
    .split(/&&|\|\||[;|&\n]/)
    .map((s) =>
      s
        .trim()
        .split(/\s+/)
        .filter((w) => w !== ""),
    )
    .filter((s) => s.length > 0);
}

/** Short flags (`-fr`) containing `letter`, or one of the long ones. */
const hasFlag = (args: string[], letter: string, long: string[]) =>
  args.some(
    (a) =>
      long.includes(a.toLowerCase()) ||
      (/^-[a-z]+$/i.test(a) && a.slice(1).toLowerCase().includes(letter)),
  );

/** The git subcommand and its arguments, past `-C dir`, `-c k=v` and other global options. */
function gitCommand(args: string[]): { sub: string; rest: string[] } {
  let i = 0;
  while (i < args.length && (args[i] as string).startsWith("-")) {
    i += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[i] as string) ? 2 : 1;
  }
  return { sub: args[i] ?? "", rest: args.slice(i + 1) };
}

/** Whether the command runs `fd`/`flightdeckd` with one of `verbs`, directly or through a runtime or a shell given the text. */
function runsFlightdeckVerb(prog: string, args: string[], verbs: readonly string[]): boolean {
  const words = args.flatMap((a) => unquoted(a).split(/\s+/)).filter(Boolean);
  if (isCliProgram(prog))
    return shellReadings(args).some((own) => verbs.includes(flightdeckWords(own)[0] ?? ""));
  if (!RUNNERS.includes(prog)) return false;
  const runsCli = words.some((_, i) => startsCli(words, i));
  return runsCli && words.some((w) => verbs.includes(w));
}

/**
 * The person's answer to a permission request is theirs: a session that runs `fd approve --hold` from
 * its own shell, directly or through a runtime or a shell, would answer for them (#3425). This is a
 * heuristic over the command text: the daemon cannot tell who holds the shell.
 */
const answersARequest = (prog: string, args: string[]) =>
  runsFlightdeckVerb(prog, args, ["approve", "deny"]);

/** `approvers enroll|reset` decide which devices may approve (#3439): a session must not run them for the person. */
const changesApprovers = (prog: string, args: string[]) =>
  runsFlightdeckVerb(prog, args, ["approvers"]);

const CARD_ENDS = new Set(["discard", "complete", "delete", "merge-local", "choose-variant"]);

/**
 * What the app asks the person to confirm, done from a session's shell (#3454): `card discard`,
 * `complete`, `delete` and `merge-local` end a card (a discard removes its worktree and branch, a
 * merge-local merges it into the base and removes them), `choose-variant` removes the other
 * variants' worktrees, `check-loop <card> on` lets the checks run the card's code unasked, and
 * `card move --force` skips a column's contract. `--confirm` is only a flag the caller types, so it
 * proves nothing.
 */
function endsACard(prog: string, args: string[]): boolean {
  const words = args.flatMap((a) => unquoted(a).split(/\s+/)).filter(Boolean);
  const forcedMove = (all: string[]) => all.includes("move") && all.includes("--force");
  const loopOn = (all: string[]) => all.includes("check-loop") && all.includes("on");
  if (isCliProgram(prog)) {
    return shellReadings(args).some((own) => {
      const [command, action, , switchTo] = flightdeckWords(own);
      return (
        command === "card" &&
        (CARD_ENDS.has(action ?? "") ||
          (action === "move" && own.includes("--force")) ||
          (action === "check-loop" && switchTo === "on"))
      );
    });
  }
  if (!RUNNERS.includes(prog)) return false;
  const runsCli = words.some((_, i) => startsCli(words, i));
  return (
    runsCli &&
    words.includes("card") &&
    (words.some((w) => CARD_ENDS.has(w)) || forcedMove(words) || loopOn(words))
  );
}

const HOSTKEY_WRITES = ["confirm", "forget"];

/**
 * Which server keys a host trusts is the person's call (#3537): `ssh hostkey confirm` pins a key, and
 * `ssh hostkey forget` unpins one so the next confirm can pin another. The reads (`ssh hostkey check`,
 * `ssh test`, `ssh list`) stay ordinary commands. The three words are matched together, so a word in an
 * argument (`fd send fd-qa "ssh hostkey confirm"`, `echo ssh hostkey forget`) is no verb.
 */
function changesTrustedHostKeys(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(prog, args, ([command, action, verb]) => {
    return command === "ssh" && action === "hostkey" && HOSTKEY_WRITES.includes(verb ?? "");
  });
}

/**
 * Which destinations a host keeps is the person's call (#3537): `ssh add` and `ssh edit` set one (its
 * address, its jump, its key path, ForwardAgent), `ssh remove` deletes one, and `ssh import apply` turns
 * `~/.ssh/config` hosts, key-file paths included, into destinations a later connect uses. The
 * reads (`ssh list`, `ssh import preview`) stay ordinary commands.
 */
function changesSshDestinations(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(prog, args, ([command, action, verb]) => {
    return (
      command === "ssh" &&
      (action === "add" ||
        action === "edit" ||
        action === "remove" ||
        (action === "import" && verb === "apply"))
    );
  });
}

/**
 * A resume that skips what the app asks a person (#3461): `history resume --force` starts the session
 * although the transcript may be running elsewhere, and `--permission-mode` picks the mode the new
 * session runs in (`bypassPermissions` included). A plain resume takes the host's defaults.
 */
function resumesWithPower(prog: string, args: string[]): boolean {
  const raised = (all: string[]) =>
    all.some(
      (w) => w === "--force" || w === "--permission-mode" || w.startsWith("--permission-mode="),
    );
  if (isCliProgram(prog)) {
    return shellReadings(args).some((own) => {
      const [command, action] = flightdeckWords(own);
      return command === "history" && action === "resume" && raised(own);
    });
  }
  if (!RUNNERS.includes(prog)) return false;
  const words = args.flatMap((a) => unquoted(a).split(/\s+/)).filter(Boolean);
  const runsCli = words.some((_, i) => startsCli(words, i));
  const resumes = words.some((w, i) => w === "history" && words[i + 1] === "resume");
  return runsCli && resumes && raised(words);
}

const PERSONA_CHANGES = ["save", "remove", "reset", "trust", "publish-agent"];
const TEAM_CHANGES = [
  "new",
  "update",
  "delete",
  "add-member",
  "remove-member",
  "pause",
  "resume",
  "close",
  "message",
];

/**
 * What the app asks the person to confirm, done from a session's shell (#3456): `persona save` and
 * `remove` rewrite or drop a persona (a saved one is a system prompt with its own permission mode),
 * `reset` throws an edit away, `trust` lets a project's versioned persona into every session, and
 * `publish-agent` writes a file into the project. `--confirm` is only a flag the caller types.
 */
const changesAPersona = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "persona", PERSONA_CHANGES);

/**
 * `team new` starts a coordinator and up to eight workers, each with its own permission mode (one may be
 * `bypassPermissions`) and each spending quota; `add-member` starts one more; `remove-member` and `delete`
 * stop a session or drop a team's record; `update` rewrites the goal and checks the coordinator is told as a
 * system notice and swaps a live member's persona (#3455). The app asks the person to fill and confirm a form.
 */
const startsATeam = (prog: string, args: string[]) => runsCliVerb(prog, args, "team", TEAM_CHANGES);

/**
 * `quota pause-at` moves or turns off the guard that holds new cards when the plan quota runs low (#3460):
 * with the guard gone, queued cards and team members start at once and spend the plan, and the setting is
 * kept in the config file. Every value is rated, since the text cannot tell a raise from a lowering.
 */
const movesTheQuotaGuard = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "quota", ["pause-at"]);

/**
 * A spend limit changed or dropped from a session's shell (#3460): `budget set` and `set-quota` raise or
 * make a limit that holds new cards back, `budget remove` drops one. A session that raises its own
 * limit spends past what the person set. Every value is rated, since the text cannot tell a raise from a lowering.
 */
const changesASpendLimit = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "budget", ["set", "set-quota", "remove"]);

/**
 * `costs reprice` rewrites the recorded cost of every message from the price table of the config (#3460),
 * so the budgets and the quota guard read other spending than was measured. `--confirm` is only a flag the caller types.
 */
const repricesTheCosts = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "costs", ["reprice"]);

/**
 * `session close` ends a session of the daemon (#3514): the app asks a person to confirm it, it drops
 * the queued messages and the open permission requests, and a team coordinator is closed with none of
 * the guards `team remove-member` has. The other session verbs undo or repeat with one more command.
 */
const endsASession = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "session", ["close"]);

/**
 * `project add` and `update` set a project's setup script (a shell command that runs in every card), its
 * auto-approval and its prompt; `harness-export` copies its instructions into the host's shared store and
 * `harness-draft` runs a model over the repository (#3515). The app has the person fill a form and press a
 * button; from a shell, any session could widen what the next card runs or is allowed to do.
 */
const changesAProject = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "project", ["add", "update", "harness-draft", "harness-export"]);

/**
 * `session create` and `fork` start a session with a folder, a prompt, a model and a permission mode of
 * their own (up to `bypassPermissions`), spending the plan; `set-mode` and `apply-persona` change what a
 * live session may do without asking (a persona carries its own permission mode and instructions). The app
 * has the person fill a form or press a button; from a shell, any session could widen its own reach.
 */
const startsOrReshapesASession = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "session", ["create", "fork", "set-mode", "apply-persona"]);

/**
 * What guards a project's sessions, changed from a session's shell (#3457): `rules remove` drops a
 * permission rule the person saved, `autoapprove resume` turns the automatic approver back on for a
 * session that got third-party content. `--confirm` is only a flag the caller types.
 */
const changesWhatGuards = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "rules", ["remove"]) ||
  runsCliVerb(prog, args, "autoapprove", ["resume"]);

/**
 * What a plugin brings into the sessions, changed from a session's shell (#3516): install and update bring
 * code that runs in sessions, uninstall and the marketplace verbs take away or add what the person set up.
 * `pin`, `unpin`, `marketplace-update` and the reads stay ordinary. `--confirm-hash` is only a word the caller types.
 */
const changesPlugins = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "plugins", [
    "install",
    "update",
    "uninstall",
    "marketplace-add",
    "marketplace-remove",
  ]);

/** A dangerous command: when it applies to a program and its arguments, and what to call it. */
const DANGEROUS: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: (prog, args) => prog === "rm" && hasFlag(args, "r", ["--recursive", "-recurse"]),
    reason: () => "rm recursivo",
  },
  {
    when: (prog, args) => prog === "chmod" && hasFlag(args, "r", ["--recursive"]),
    reason: () => "chmod -R",
  },
  {
    when: (prog, args) =>
      ["del", "erase", "rd", "rmdir"].includes(prog) && args.some((a) => /^\/s$/i.test(a)),
    reason: (prog) => `${prog} /s`,
  },
  {
    when: (prog, args) => prog === "format" && /^[a-z]:/i.test(args[0] ?? ""),
    reason: () => "format de disco",
  },
  {
    when: (prog, args) =>
      ["remove-item", "ri"].includes(prog) && args.some((a) => /^-r(ec\w*)?$/i.test(a)),
    reason: () => "Remove-Item -Recurse",
  },
  {
    when: answersARequest,
    reason: () => "answers a permission request (flightdeckd approve or deny)",
  },
  {
    when: changesApprovers,
    reason: () => "changes the devices that may approve (flightdeckd approvers)",
  },
  {
    when: endsACard,
    reason: () =>
      "does what the app asks a person to confirm (flightdeckd card discard, complete, delete, merge-local, choose-variant, check-loop on or move --force)",
  },
  {
    when: changesTrustedHostKeys,
    reason: () =>
      "changes which server keys a host trusts, without the person confirming it in the app (flightdeckd ssh hostkey confirm or forget)",
  },
  {
    when: changesSshDestinations,
    reason: () =>
      "adds, changes or removes an ssh destination, or turns ~/.ssh/config hosts into destinations, without the person choosing it in the app (flightdeckd ssh add, edit, remove or import apply)",
  },
  {
    when: opensATerminal,
    reason: () =>
      "opens a terminal on the host, a shell that runs what is typed into it, without the person opening it in the app (flightdeckd terminal open or open-session)",
  },
  {
    when: enablesTerminals,
    reason: () =>
      "turns the host's terminals on, a full shell for whoever reaches the daemon, without the person choosing it in the app (flightdeckd terminal settings --enable)",
  },
  {
    when: changesAWatch,
    reason: () =>
      "changes what a card's PR watch does on its own, which sessions it wakes and what it spends, without the person choosing it in the app (flightdeckd watch set, extend, resolve-held or settings with a flag)",
  },
  {
    when: changesWhatGuards,
    reason: () => "changes what guards the sessions (flightdeckd rules remove, autoapprove resume)",
  },
  {
    when: changesAPersona,
    reason: () =>
      "changes what the app asks a person to confirm (flightdeckd persona save, remove, reset, trust or publish-agent)",
  },
  {
    when: resumesWithPower,
    reason: () =>
      "does what the app asks a person to confirm (flightdeckd history resume --force, or with a permission mode)",
  },
  {
    when: startsATeam,
    reason: () =>
      "starts or drops sessions the person has not approved one by one, some perhaps without permission prompts (flightdeckd team new, update, delete, add-member, remove-member, pause, resume, close or message)",
  },
  {
    when: endsASession,
    reason: () =>
      "ends a session the person did not end, drops its queued messages and its open permission requests, and skips the team's guard on a coordinator (flightdeckd session close)",
  },
  {
    when: changesAProject,
    reason: () =>
      "sets what a project runs or allows without the person confirming it in the app: its setup script, its auto-approval, or the instructions it exports to the shared store, and a drafted CLAUDE.md is a model call (flightdeckd project add, update, harness-draft or harness-export)",
  },
  {
    when: startsOrReshapesASession,
    reason: () =>
      "starts a session, or changes what a live one may do or the persona it follows, without the person confirming it in the app (flightdeckd session create, set-mode, fork or apply-persona)",
  },
  {
    when: movesTheQuotaGuard,
    reason: () =>
      "moves or turns off the plan-quota guard that holds new cards back, so sessions can spend past the plan the person set (flightdeckd quota pause-at)",
  },
  {
    when: changesASpendLimit,
    reason: () =>
      "raises, moves or drops a cost limit that holds new cards back, so sessions can spend past what the person set (flightdeckd budget set, set-quota or remove)",
  },
  {
    when: repricesTheCosts,
    reason: () =>
      "rewrites the recorded cost of every message, so the budgets and the quota guard read other spending than was measured (flightdeckd costs reprice)",
  },
  {
    when: changesPlugins,
    reason: () =>
      "brings code that runs in sessions, or takes away what the person set up (flightdeckd plugins install, update, uninstall, marketplace-add or marketplace-remove)",
  },
  { when: (prog) => ["eval", "iex", "invoke-expression"].includes(prog), reason: (prog) => prog },
  {
    when: (prog, args) =>
      ["pwsh", "powershell"].includes(prog) && args.some((a) => /^-(e|ec|en\w*)$/i.test(a)),
    reason: () => "-EncodedCommand",
  },
];

/** The destructive git subcommands: a forced push, `reset --hard`, `clean -f`. */
function gitRisks(args: string[]): Candidate[] {
  const { sub, rest } = gitCommand(args);
  const force =
    hasFlag(rest, "f", ["--force"]) ||
    rest.some((a) => a.startsWith("--force-with-lease") || a.startsWith("+"));
  const out: Candidate[] = [];
  if (sub === "push" && force) out.push(["high", "git push forçado"]);
  if (sub === "reset" && rest.includes("--hard")) out.push(["high", "git reset --hard"]);
  if (sub === "clean" && hasFlag(rest, "f", ["--force"])) out.push(["high", "git clean -f"]);
  return out;
}

/** What one segment of a shell command adds, given whether a pipe feeds it: one reading for each program it may run. */
function segmentRisks(segment: string[], piped: boolean): Candidate[] {
  const out = invocations(segment).flatMap((call) => invocationRisks(call, piped));
  // A process substitution (`cat <(fd card delete c1)`) runs a command of its own.
  segment.forEach((word, i) => {
    if (/^[<>]\(/.test(word))
      out.push(...segmentRisks([word.slice(2), ...segment.slice(i + 1)], false));
  });
  return out;
}

function invocationRisks(call: Invocation, piped: boolean): Candidate[] {
  const { prog, args, sudo } = call;
  const out: Candidate[] = [];
  if (sudo) out.push(["high", "sudo"]);
  if (
    call.hidden ||
    (isCliProgram(prog) && hidesItsVerb(args, call.unresolved)) ||
    runnerHidesAVerb(prog, args)
  )
    out.push(["high", HIDDEN_VERB]);
  if (piped && SHELLS.has(prog)) out.push(["high", `pipe para ${prog}`]);
  for (const rule of DANGEROUS) {
    if (rule.when(prog, args)) out.push(["high", rule.reason(prog)]);
  }
  if (prog === "git") out.push(...gitRisks(args));
  // A shell given text (`sh -c '$FD card delete c1'`) runs it as a command line of its own (#3499).
  const text = shellText(prog, args);
  if (text !== undefined) out.push(...statementRisks(text));
  // `find -exec <command> ;` runs the command for each file.
  if (prog === "find") out.push(...execRisks(args));
  return out;
}

/** The commands `find` runs with `-exec`, `-execdir` or `-ok`, up to their `;` or `+`. */
function execRisks(args: string[]): Candidate[] {
  const out: Candidate[] = [];
  args.forEach((arg, i) => {
    if (!["-exec", "-execdir", "-ok", "-okdir"].includes(arg)) return;
    const end = args.findIndex((a, j) => j > i && [";", String.raw`\;`, "+"].includes(a));
    out.push(...segmentRisks(args.slice(i + 1, end < 0 ? undefined : end), false));
  });
  return out;
}

/** A shell's "run this text" flag: `-c` or any letters with a c in them after a dash (`-lc`, `-Command`), or `/c`; any case. */
const isCommandFlag = (arg: string) => hasFlag([arg], "c", ["/c"]);

/** The text a shell is told to run with `-c`, `-lc`, `-Command` or `/c`, without its outer quotes; none otherwise. */
function shellText(prog: string, args: string[]): string | undefined {
  if (!SHELLS.has(prog) || ["iex", "invoke-expression"].includes(prog)) return undefined;
  const flag = args.findIndex(isCommandFlag);
  if (flag < 0) return undefined;
  return args
    .slice(flag + 1)
    .join(" ")
    .replace(/^["']|["']$/g, "");
}

/** What each command of a shell line adds: a pipe hands its output to the next command, so a part knows if it is fed. */
function statementRisks(command: string): Candidate[] {
  const out: Candidate[] = [];
  const read = (
    statements: string[],
    pipes: (statement: string) => string[],
    cut: (part: string) => string[][],
  ) => {
    for (const statement of statements) {
      pipes(statement).forEach((part, i) => {
        for (const segment of cut(part)) out.push(...segmentRisks(segment, i > 0));
      });
    }
  };
  // Read twice: cut at every separator, which cannot miss a command that follows one, and cut only outside
  // quotes, which keeps a quoted value that holds a separator (`fd --prompt "a;b" session create`) from
  // cutting the verb off its program (#3514).
  read(command.split(/&&|\|\||[;&\n]/), (statement) => statement.split("|"), segments);
  read(
    splitOutsideQuotes(command, ["&&", "||", ";", "&", "\n"]),
    (statement) => splitOutsideQuotes(statement, ["|"]),
    (part) =>
      [
        part
          .trim()
          .split(/\s+/)
          .filter((w) => w !== ""),
      ].filter((s) => s.length > 0),
  );
  return out;
}

/** `text` cut at each of `separators` (the longest first) that sits outside single and double quotes. */
function splitOutsideQuotes(text: string, separators: string[]): string[] {
  const parts: string[] = [];
  let quote = "";
  let from = 0;
  for (let i = 0; i < text.length; ) {
    const step = stepQuote(quote, text, i);
    const separator =
      quote === "" && step.open === "" ? separators.find((s) => text.startsWith(s, i)) : undefined;
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

/** An MCP tool from any server: a free command with a secret and a discarded card are high risk. */
function mcpCandidates(toolName: string, input: Record<string, unknown>): Candidate[] {
  // Phase 17: a command Claude wrote, with a secret in its environment, from any server.
  if (toolName.endsWith("__run_with_secret")) {
    return [["high", "comando livre com segredo no ambiente"]];
  }
  // A session throwing its own card away: the worktree and the branch go with it.
  if (toolName.endsWith("__finish_card") && input.outcome === "discard") {
    return [["high", "descarta o card, a worktree e a branch"]];
  }
  return /delete|drop|destroy/i.test(toolName)
    ? [["high", "ferramenta MCP destrutiva"]]
    : [["medium", "ferramenta MCP"]];
}

/** A shell tool's `command` that is there but is not text: nothing in it can be judged. */
const oddCommand = (input: Record<string, unknown>) =>
  input.command !== undefined && input.command !== null && typeof input.command !== "string";

export class RiskClassifier {
  private readonly extra: RegExp[];

  constructor(readonly opts: RiskOptions) {
    this.extra = (opts.extraHigh ?? []).map((source) => new RegExp(source, "i"));
  }

  classify(toolName: string, input: Record<string, unknown>, cwd: string): Risk {
    const candidates = this.candidates(toolName, input, cwd);
    const [first, ...rest] = candidates as [Candidate, ...Candidate[]];
    const [level, reason] = rest.reduce((a, b) => (RANK[b[0]] > RANK[a[0]] ? b : a), first);
    return { level, reason, network: this.network(toolName, input) };
  }

  private readCandidates(
    toolName: string,
    fields: readonly string[],
    text: (key: string) => string,
    cwd: string,
  ): Candidate[] {
    const paths = fields.map((f) => text(f) || cwd);
    // Glob's pattern names files; Grep's searches their contents, so only its `glob` counts.
    const patterns = [toolName === "Glob" ? text("pattern") : "", text("glob")].filter(
      (p) => p !== "",
    );
    if ([...paths, ...patterns].some(credential)) return [["high", "caminho de credencial"]];
    return paths.every((p) => this.allowed(p, cwd))
      ? [["low", "leitura dentro do projeto"]]
      : [["medium", "leitura fora do cwd e de allowedRoots"]];
  }

  private candidates(toolName: string, input: Record<string, unknown>, cwd: string): Candidate[] {
    const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
    if (SHELL_TOOLS.has(toolName)) {
      // A shell tool's command that is there but not text cannot be read, so a person decides.
      if (oddCommand(input)) return [["high", "the command is not text"]];
      return this.shellCandidates(text("command"), cwd, toolName === "PowerShell");
    }
    if (toolName === "TodoWrite") return [["low", "lista de tarefas"]];
    const fields = READ_TOOLS[toolName];
    if (fields) return this.readCandidates(toolName, fields, text, cwd);
    if (WRITE_TOOLS.has(toolName)) {
      // A call that names both keys is judged by each path, and the stricter one wins (#2479).
      const named = [text("file_path"), text("notebook_path")].filter((p) => p !== "");
      // A path key that is there but is not text cannot be judged, so a person decides (#2484).
      const odd = ["file_path", "notebook_path"].some(
        (key) => input[key] !== undefined && input[key] !== null && typeof input[key] !== "string",
      );
      const out = (named.length > 0 ? named : [""]).map((path): Candidate => {
        if (credential(path)) return ["high", "escrita em caminho de credencial"];
        if (opencodeConfig(path)) return ["high", "writes OpenCode's configuration"];
        return this.allowed(path, cwd)
          ? ["medium", "escrita dentro do projeto"]
          : ["high", "escrita fora do cwd e de allowedRoots"];
      });
      if (odd) out.push(["high", "the path is not text"]);
      return out;
    }
    if (NETWORK_TOOLS.has(toolName)) return [["medium", "acessa a rede"]];
    // Phase 39: an OpenCode tool the normalizer could not map (Code Mode, another MCP server).
    if (toolName.startsWith("opencode:"))
      return [["high", "an OpenCode tool Flightdeck does not know"]];
    if (toolName.startsWith("mcp__")) return mcpCandidates(toolName, input);
    return [["medium", "ferramenta que o classificador não conhece"]];
  }

  /** The command as written, and as a shell that joins continuation lines reads it. */
  private shellCandidates(command: string, cwd: string, powershell: boolean): Candidate[] {
    const joined = joinContinuations(command);
    const written = this.shell(command, cwd);
    const out = joined === command ? written : [...written, ...this.shell(joined, cwd)];
    // PowerShell's backslash is a path separator and its escape is the backtick (#3559): the line is read once more
    // with the two swapped, so `"C:\work\" persona remove qa` does not read as one open string.
    const swapped = command.replace(/\\/g, "/").replace(/`/g, "\\");
    return powershell && swapped !== command ? [...out, ...this.shell(swapped, cwd)] : out;
  }

  private shell(command: string, cwd: string): Candidate[] {
    const out: Candidate[] = [["medium", "comando de shell"]];
    out.push(...statementRisks(command));
    if (/\$\(|`/.test(command)) out.push(["high", "substituição de comando"]);
    if (/(^|\s)-encodedcommand(\s|$)/i.test(command)) out.push(["high", "-EncodedCommand"]);
    if (/\bbase64\b[^|;&\n]*\s(-d|-D|--decode)\b[^|;&\n]*\|/.test(command)) {
      out.push(["high", "base64 -d em pipe"]);
    }
    // `>`, `>>`, `&>`, `&>>`, `>&file`, `>|file` and `<>file`; `>&2` and `>&-` copy or close a
    // descriptor. The lookbehind (not a consumed character) lets a second adjacent redirect, `a>b>c`,
    // match too, unless that first `>` is escaped. The target is one shell word: quoted and bare
    // parts glued together (#2496).
    for (const match of command.matchAll(REDIRECT)) {
      const word = match[2] as string;
      const target = word.replace(/["']/g, "");
      if (match[1] === "&" && /^(\d+-?|-)$/.test(target)) continue;
      if (SINKS.has(target.toLowerCase())) continue;
      // A `>` that is only quoted text can start a match whose "quoted target" runs over a real
      // redirect further on; a quoted part with a shell operator in it is never a plain name.
      const spans = /"[^"]*[;&|<>\n]|'[^']*[;&|<>\n]/.test(word);
      if (
        spans ||
        /[$%{*?[]|^\(|^~(?![\\/]|$)|^!|^=\(/.test(target) ||
        !this.insideAny(target, cwd)
      ) {
        out.push(["high", "redirecionamento para fora do cwd"]);
      }
    }
    if (words(command).some(credential)) out.push(["high", "caminho de credencial"]);
    if (words(command).some(opencodeConfig)) out.push(["high", "writes OpenCode's configuration"]);
    if (this.extra.some((re) => re.test(command))) out.push(["high", "padrão de risk.extraHigh"]);
    return out;
  }

  private network(toolName: string, input: Record<string, unknown>): boolean {
    if (
      NETWORK_TOOLS.has(toolName) ||
      toolName.startsWith("mcp__") ||
      toolName.startsWith("opencode:")
    ) {
      return true;
    }
    if (!SHELL_TOOLS.has(toolName)) return false;
    // A command that is not text fails closed, as its level does (`candidates`).
    if (oddCommand(input)) return true;
    const command = typeof input.command === "string" ? input.command : "";
    return [command, joinContinuations(command)].some((text) =>
      segments(text).some((segment) => {
        return invocations(segment).some(({ prog, args }) => {
          const sub = prog === "git" ? gitCommand(args).sub : "";
          return NETWORK_PROGRAMS.has(prog) || ["push", "pull", "fetch", "clone"].includes(sub);
        });
      }),
    );
  }

  /** Inside the cwd or one of `allowedRoots`. */
  private allowed(path: string, cwd: string): boolean {
    return this.inside(path, cwd, this.opts.allowedRoots);
  }

  /**
   * A redirect target read three ways: as written, with `\` as a separator (Windows) and with `\`
   * as an escape (bash, where `\/etc/x` is `/etc/x`). Outside the cwd in any of them is outside.
   */
  private insideAny(target: string, cwd: string): boolean {
    return [target, target.replaceAll("\\", "/"), target.replaceAll("\\", "")].every((reading) =>
      this.inside(reading, cwd, []),
    );
  }

  private inside(path: string, cwd: string, roots: readonly string[]): boolean {
    const home = /^~(?=$|[\\/])/.test(path) ? join(this.opts.home, path.slice(1)) : path;
    const full = resolve(cwd, home);
    return [cwd, ...roots].some((root) => isInside(resolve(root), full));
  }
}
