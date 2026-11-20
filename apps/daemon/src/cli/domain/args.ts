/**
 * The `flightdeckd` command line (issue #1593): its words, flags and usage, parsed into `CliArgs`
 * with no effect; `main.ts` runs what they ask for.
 */
import { RuntimeKind } from "../../config.ts";
import { boardProblem } from "./board-args.ts";
import type { CliArgs, ServiceAction } from "./cli-args.ts";
import { EFFORTS, PERMISSION_MODES, personaProblem } from "./persona-args.ts";
import { teamProblem } from "./team-args.ts";
import { USAGE } from "./usage.ts";

export type { CliArgs, ServiceAction } from "./cli-args.ts";
export { USAGE } from "./usage.ts";

const SERVICE_ACTIONS: readonly ServiceAction[] = [
  "install",
  "uninstall",
  "status",
  "stop",
  "start",
];

/** Where the parser is in the command line; a handler reads the words after its own through it. */
class ArgReader {
  private i = 0;
  constructor(private readonly argv: readonly string[]) {}

  /** The word the parser is on, or undefined once the line is read. */
  current(): string | undefined {
    return this.argv[this.i];
  }

  advance(): void {
    this.i++;
  }

  /** The next word, moving onto it. */
  next(): string | undefined {
    return this.argv[++this.i];
  }

  /** The next word, without moving. */
  peek(): string | undefined {
    return this.argv[this.i + 1];
  }

  /** Everything after the current word, which the caller then owns (the parser stops). */
  takeRest(): string[] {
    const rest = this.argv.slice(this.i + 1);
    this.i = this.argv.length;
    return rest;
  }
}

type Handler = (args: CliArgs, reader: ArgReader, value: () => string) => void;

const invalid = (what: string, got: string | undefined, none = "(none)") =>
  new Error(`${what}: ${got ?? none}\n${USAGE}`);

/** The word after a command, which must be one of `allowed`. */
function subAction<T extends string>(
  reader: ArgReader,
  allowed: readonly T[],
  what: string,
  none?: string,
): T {
  const action = reader.next();
  if (action === undefined || !(allowed as readonly string[]).includes(action)) {
    throw invalid(what, action, none);
  }
  return action as T;
}

/** A name after an action (`action run <name>`); it cannot be another flag. */
function operand(reader: ArgReader, what: string): string {
  const next = reader.next();
  if (next === undefined || next.startsWith("--")) throw new Error(`missing ${what}\n${USAGE}`);
  return next;
}

const setCommand =
  (command: CliArgs["command"]): Handler =>
  (args) => {
    args.command = command;
  };

/** A command whose word after it is one of `allowed`, kept in `args.action`. */
const withAction =
  <T extends string>(command: CliArgs["command"], allowed: readonly T[], what: string): Handler =>
  (args, reader) => {
    args.command = command;
    args.action = subAction(reader, allowed, what) as never;
  };

const setValue =
  (set: (args: CliArgs, value: string) => void): Handler =>
  (args, _reader, value) => {
    set(args, value());
  };

/** A flag that takes no value: `--hold=false` is an error, never a `--hold` (#3425). */
const FLAGS = new WeakSet<Handler>();
const setFlag = (set: (args: CliArgs) => void): Handler => {
  const handler: Handler = (args) => {
    set(args);
  };
  FLAGS.add(handler);
  return handler;
};

/** The command word is the first one: a second would replace it and keep the first one's operands. */
function startCommand(args: CliArgs, command: CliArgs["command"]): void {
  if (args.command !== "start")
    throw new Error(`one command at a time: ${args.command}, then ${command}\n${USAGE}`);
  args.command = command;
}

/** `action list|run <name>`, `snippet list|get <name>`: the second word may take a name. */
const withNamedAction =
  (
    command: CliArgs["command"],
    allowed: readonly ["list", "run" | "get"],
    what: string,
    nameWhat: string,
    keep: (args: CliArgs, name: string) => void,
  ): Handler =>
  (args, reader) => {
    args.command = command;
    const action = subAction(reader, allowed, what);
    args.action = action as never;
    if (action === allowed[1]) keep(args, operand(reader, nameWhat));
  };

/** The words of `fd` that are not subcommands but are still Flightdeck's own. */
const FD_FLAGS = ["--version", "--help", "-h"];

/** The pack personas a shortcut word opens: the word is the persona's id (#3413, #3441). */
const SHORTCUTS = ["architect", "reviewer", "security", "coordinator"] as const;

/** `flightdeckd <word>` is `flightdeckd claude --persona <id> ...`: one launch path, the claude one. */
const openWith =
  (persona: (reader: ArgReader) => string): Handler =>
  (args, reader) => {
    args.command = "claude";
    const id = persona(reader);
    args.claudeArgs = ["--persona", id, ...reader.takeRest()];
  };

const HANDLERS: Record<string, Handler> = {
  db: (args, reader) => {
    args.command = "db";
    subAction(reader, ["prune"], "invalid db action");
  },
  backup: setCommand("backup"),
  restore: (args, reader) => {
    args.command = "restore";
    const next = reader.peek();
    if (next && !next.startsWith("--")) args.file = reader.next();
  },
  update: setCommand("update"),
  "--version": setCommand("version"),
  start: setCommand("start"),
  pair: setCommand("pair"),
  setup: setCommand("setup"),
  doctor: setCommand("doctor"),
  channel: setCommand("channel"),
  mcp: setCommand("mcp"),
  statusline: setCommand("statusline"),
  service: withAction("service", SERVICE_ACTIONS, "invalid service action"),
  hook: (args, reader) => {
    args.command = "hook";
    const event = reader.next();
    if (event !== "session-start") throw new Error(`invalid hook: ${event ?? "(none)"}`);
  },
  claude: (args, reader) => {
    args.command = "claude";
    args.claudeArgs = reader.takeRest();
  },
  ...Object.fromEntries(SHORTCUTS.map((word) => [word, openWith(() => word)])),
  new: openWith((reader) => {
    const id = reader.next();
    if (id === undefined || id.startsWith("-")) throw new Error(`missing persona id\n${USAGE}`);
    return id;
  }),
  // `fd <subcommand>` is `flightdeckd <subcommand>`; anything else goes to claude, as the alias did (#3433).
  fd: (args, reader) => {
    // Only the first word: after another command, `fd` would silently turn it into claude.
    if (args.command !== "start") throw new Error(`unknown argument: fd\n${USAGE}`);
    const rest = reader.takeRest();
    const word = rest[0] ?? "";
    const own = word !== "fd" && Object.hasOwn(HANDLERS, word) && !word.startsWith("-");
    if (own || FD_FLAGS.includes(word)) Object.assign(args, parseArgs(rest));
    else Object.assign(args, { command: "claude", claudeArgs: rest });
  },
  "--help": setCommand("help"),
  "-h": setCommand("help"),
  askpass: (args, reader) => {
    args.command = "askpass";
    args.askpassPrompt = reader.takeRest().join(" ");
  },
  hooks: withAction("hooks", ["install", "uninstall", "status"], "invalid hooks action"),
  telemetry: withAction(
    "telemetry",
    ["install", "uninstall", "status"],
    "invalid telemetry action",
  ),
  history: withAction("history", ["reindex"], "invalid history action"),
  approvers: withAction("approvers", ["enroll", "reset"], "invalid approvers action"),
  rules: withAction("rules", ["list"], "invalid rules action"),
  autoapprove: withAction("autoapprove", ["list"], "invalid autoapprove action"),
  action: withNamedAction(
    "action",
    ["list", "run"],
    "invalid action",
    "the action name",
    (args, name) => {
      args.actionName = name;
    },
  ),
  snippet: withNamedAction(
    "snippet",
    ["list", "get"],
    "invalid snippet action",
    "the snippet name",
    (args, name) => {
      args.snippetName = name;
    },
  ),
  message: (args, reader) => {
    args.command = "message";
    const action = subAction(
      reader,
      ["list", "send", "idle", "read", "team"],
      "invalid message action",
    );
    args.action = action as never;
    if (action === "send") {
      args.to = operand(reader, "the session address");
      args.text = operand(reader, "the text");
    }
    if (action === "idle" || action === "read") args.session = operand(reader, "the session");
    if (action === "team") args.team = operand(reader, "the team");
  },
  card: (args, reader) => {
    args.command = "card";
    const action = subAction(
      reader,
      [
        "list",
        "show",
        "new",
        "start",
        "move",
        "update",
        "stop",
        "complete",
        "delete",
        "discard",
        "diff",
        "spec",
        "review",
        "message",
        "templates",
        "validation-template",
        "pr-create",
        "update-from-base",
        "merge-local",
        "arena",
        "start-arena",
        "choose-variant",
        "check-loop",
        "dismiss-unblocked",
      ],
      "invalid card action",
    );
    args.action = action;
    // Every action but `list`, `new` and `templates` names the card it works on.
    if (!["list", "new", "templates"].includes(action)) args.cardId = operand(reader, "the card");
    if (action === "move") args.column = operand(reader, "the column");
    if (action === "choose-variant") args.variant = operand(reader, "the variant");
    if (action === "check-loop") {
      const loop = operand(reader, "on or off");
      if (loop !== "on" && loop !== "off")
        throw new Error(`card check-loop: on or off, not "${loop}"\n${USAGE}`);
      args.loop = loop;
    }
    if (action === "message") args.text = operand(reader, "the text");
    if (action === "new") args.cardTitle = operand(reader, "the title");
  },
  board: (args, reader) => {
    args.command = "board";
    args.action = subAction(reader, ["settings", "watch"] as const, "invalid board action");
  },
  team: (args, reader) => {
    args.command = "team";
    const action = subAction(
      reader,
      ["list", "show", "new", "update", "delete", "add-member", "remove-member"],
      "invalid team action",
    );
    args.action = action;
    if (action !== "list" && action !== "new") args.teamId = operand(reader, "the team");
    if (action === "new") args.teamGoal = operand(reader, "the goal");
    if (action === "remove-member") args.teamMember = operand(reader, "the member");
    if (action === "add-member") {
      const next = reader.peek();
      if (next && !next.startsWith("--")) args.teamSpec = reader.next();
    }
  },
  persona: (args, reader) => {
    args.command = "persona";
    const action = subAction(
      reader,
      ["list", "show", "subagents", "save", "remove", "reset", "publish-agent", "trust"],
      "invalid persona action",
    );
    args.action = action;
    if (action !== "list" && action !== "subagents")
      args.personaId = operand(reader, "the persona");
  },
  host: setCommand("host"),
  sessions: setCommand("sessions"),
  requests: (args) => {
    startCommand(args, "requests");
  },
  send: (args, reader) => {
    startCommand(args, "send");
    args.sendTo = operand(reader, "the session");
    args.text = operand(reader, "the text");
  },
  approve: (args, reader) => {
    startCommand(args, "approve");
    args.requestId = operand(reader, "the request");
  },
  deny: (args, reader) => {
    startCommand(args, "deny");
    args.requestId = operand(reader, "the request");
  },
  "--message": setValue((args, v) => {
    args.answerMessage = v;
  }),
  "--squash": setFlag((args) => {
    args.squash = true;
  }),
  "--force": setFlag((args) => {
    args.force = true;
  }),
  "--confirm": setFlag((args) => {
    args.confirm = true;
  }),
  "--position": setValue((args, v) => {
    const position = Number(v);
    if (v.trim() === "" || !Number.isInteger(position) || position < 0)
      throw new Error(`--position needs a whole number from 0\n${USAGE}`);
    args.position = position;
  }),
  "--workers": setValue((args, v) => {
    // Digits only: `Number` would take `0x2`, `2e0` and a padded " 2 ".
    args.teamWorkers = /^\d+$/.test(v) ? Number(v) : Number.NaN;
  }),
  "--worker": setValue((args, v) => {
    args.teamWorkerSpecs = [...(args.teamWorkerSpecs ?? []), v];
  }),
  "--coordinator": setValue((args, v) => {
    args.teamCoordinator = v;
  }),
  "--check": setValue((args, v) => {
    args.teamChecks = [...(args.teamChecks ?? []), v];
  }),
  "--goal": setValue((args, v) => {
    if (args.teamGoalFlag !== undefined) throw new Error(`--goal: once\n${USAGE}`);
    args.teamGoalFlag = v;
  }),
  "--persona": setValue((args, v) => {
    if (args.teamPersona !== undefined) throw new Error(`--persona: once\n${USAGE}`);
    args.teamPersona = v;
  }),
  "--clear-checks": setFlag((args) => {
    args.teamClearChecks = true;
  }),
  "--variant": setValue((args, v) => {
    args.variants = [...(args.variants ?? []), v];
  }),
  "--max-parallel-runs": setValue((args, v) => {
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < 1)
      throw new Error(`--max-parallel-runs needs a whole number, 1 or more\n${USAGE}`);
    args.maxParallelRuns = Number(v);
  }),
  "--rounds": setValue((args, v) => {
    const rounds = Number(v);
    if (!/^\d+$/.test(v) || rounds < 1 || rounds > 10)
      throw new Error(`--rounds needs a whole number from 1 to 10\n${USAGE}`);
    args.rounds = rounds;
  }),
  "--title": setValue((args, v) => {
    args.titleFlag = v;
  }),
  "--estimate": setValue((args, v) => {
    args.estimate = v;
  }),
  "--validation-note": setValue((args, v) => {
    args.validationNote = v;
  }),
  "--spec-path": setValue((args, v) => {
    args.specPath = v;
  }),
  "--blocked-by": setValue((args, v) => {
    args.blockedBy = v;
  }),
  "--hold": setFlag((args) => {
    args.hold = true;
  }),
  "--session": setValue((args, v) => {
    args.session = v;
  }),
  "--json": setFlag((args) => {
    args.json = true;
  }),
  "--host": setValue((args, v) => {
    args.host = v;
  }),
  "--description": setValue((args, v) => {
    args.description = v;
  }),
  "--name": setValue((args, v) => {
    args.personaName = v;
  }),
  "--body": setValue((args, v) => {
    args.body = v;
  }),
  "--body-file": setValue((args, v) => {
    args.bodyFile = v;
  }),
  "--model": setValue((args, v) => {
    args.model = v;
  }),
  "--effort": setValue((args, v) => {
    if (!EFFORTS.includes(v)) throw new Error(`--effort: ${EFFORTS.join(", ")}\n${USAGE}`);
    args.effort = v as NonNullable<CliArgs["effort"]>;
  }),
  "--tools": setValue((args, v) => {
    const tools = v
      .split(",")
      .map((tool) => tool.trim())
      .filter((tool) => tool !== "");
    if (tools.length === 0) throw new Error(`--tools: a comma-separated list of tools\n${USAGE}`);
    args.tools = tools;
  }),
  "--permission-mode": setValue((args, v) => {
    if (!PERMISSION_MODES.includes(v))
      throw new Error(`--permission-mode: ${PERMISSION_MODES.join(", ")}\n${USAGE}`);
    args.permissionMode = v;
  }),
  "--hash": setValue((args, v) => {
    if (!/^[0-9a-f]{12,}$/i.test(v))
      throw new Error(
        `--hash: at least 12 hex characters of the hash persona list shows\n${USAGE}`,
      );
    args.hash = v.toLowerCase();
  }),
  "--icon": setValue((args, v) => {
    args.icon = v;
  }),
  "--language": setValue((args, v) => {
    if (v !== "en" && v !== "pt-BR") throw new Error(`--language: en or pt-BR\n${USAGE}`);
    args.language = v;
  }),
  "--workflow": setValue((args, v) => {
    args.workflow = v;
  }),
  "--out": setValue((args, v) => {
    args.out = v;
  }),
  "--from": setValue((args, v) => {
    args.from = v;
  }),
  "--allow-downgrade": setFlag((args) => {
    args.allowDowngrade = true;
  }),
  "--yes": setFlag((args) => {
    args.yes = true;
  }),
  "--folders": setValue((args, v) => {
    args.folders = v
      .split(",")
      .map((folder) => folder.trim())
      .filter(Boolean);
  }),
  "--rotate": setFlag((args) => {
    args.rotate = true;
  }),
  "--launch": setValue((args, v) => {
    args.launch = v;
  }),
  "--url": setValue((args, v) => {
    args.url = v;
  }),
  "--token": setValue((args, v) => {
    args.token = v;
  }),
  "--last": setValue((args, v) => {
    const last = Number(v);
    if (!Number.isInteger(last) || last < 1)
      throw new Error(`--last needs a positive integer\n${USAGE}`);
    args.last = last;
  }),
  "--scope": setValue((args, v) => {
    if (v !== "host" && v !== "project" && v !== "all")
      throw new Error(`--scope: host, project or all, got ${v}\n${USAGE}`);
    args.scope = v;
  }),
  "--limit": setValue((args, v) => {
    const n = Number(v);
    if (!/^\d+$/.test(v) || n < 1 || n > 1000)
      throw new Error(`--limit: a whole number from 1 to 1000, got ${v}\n${USAGE}`);
    args.limit = n;
  }),
  "--project": setValue((args, v) => {
    args.project = v;
  }),
  "--project-path": setValue((args, v) => {
    args.projectPath = v;
  }),
  "--query": setValue((args, v) => {
    args.query = v;
  }),
  "--param": setValue((args, v) => {
    const [key, ...rest] = v.split("=");
    if (!key || rest.length === 0) throw new Error(`--param needs key=value\n${USAGE}`);
    args.params = { ...args.params, [key]: rest.join("=") };
  }),
  "--dry-run": setFlag((args) => {
    args.dryRun = true;
  }),
  "--config": setValue((args, v) => {
    args.config = v;
  }),
  "--runtime": setValue((args, v) => {
    args.runtime = RuntimeKind.parse(v);
  }),
};

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { command: "start" };
  const reader = new ArgReader(argv);
  for (let arg = reader.current(); arg !== undefined; reader.advance(), arg = reader.current()) {
    const cut = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = cut < 0 ? arg : arg.slice(0, cut);
    const inline = cut < 0 ? undefined : arg.slice(cut + 1);
    const value = () => {
      const v = inline ?? reader.next();
      if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value\n${USAGE}`);
      return v;
    };
    const handler = Object.hasOwn(HANDLERS, flag) ? HANDLERS[flag] : undefined;
    if (!handler) throw new Error(`unknown argument: ${arg}\n${USAGE}`);
    if (inline !== undefined && FLAGS.has(handler))
      throw new Error(`${flag} needs no value\n${USAGE}`);
    handler(args, reader, value);
  }
  if (
    args.json &&
    ![
      "card",
      "board",
      "team",
      "persona",
      "host",
      "sessions",
      "requests",
      "send",
      "approve",
      "deny",
      "approvers",
      "rules",
      "autoapprove",
    ].includes(args.command)
  )
    throw new Error(
      `--json: this flag only applies to flightdeckd card, board, team, persona, host, sessions, requests, send, approve, deny, approvers, rules and autoapprove\n${USAGE}`,
    );
  if (
    args.host !== undefined &&
    !["host", "sessions", "requests", "send", "approve", "deny"].includes(args.command)
  )
    throw new Error(
      `--host: this flag only applies to flightdeckd host, sessions, requests, send, approve and deny\n${USAGE}`,
    );
  if (args.hold && args.command !== "approve")
    throw new Error(`--hold: this flag only applies to flightdeckd approve\n${USAGE}`);
  if (
    args.answerMessage !== undefined &&
    !["approve", "deny"].includes(args.command) &&
    !(args.command === "card" && args.action === "merge-local")
  )
    throw new Error(
      `--message: this flag only applies to flightdeckd approve and deny, and to card merge-local\n${USAGE}`,
    );
  if (!["requests", "message", "autoapprove"].includes(args.command) && args.session !== undefined)
    throw new Error(
      `--session: this flag only applies to flightdeckd requests, message and autoapprove\n${USAGE}`,
    );
  if (args.command !== "autoapprove" && args.limit !== undefined)
    throw new Error(`--limit: this flag only applies to flightdeckd autoapprove\n${USAGE}`);
  // `card new` takes its title as an operand: the flag is the title of an update.
  if (args.titleFlag !== undefined && ["update", "pr-create"].includes(args.action as string))
    args.cardTitle = args.titleFlag;
  const flagged: Array<[string, unknown, readonly string[] | null]> = [
    ["--title", args.titleFlag, ["update", "pr-create"]],
    ["--description", args.description, ["new", "update", "pr-create"]],
    ["--workflow", args.workflow, ["start", "start-arena"]],
    ["--variant", args.variants, ["start-arena"]],
    ["--rounds", args.rounds, ["check-loop"]],
    ["--force", args.force, ["move"]],
    ["--position", args.position, ["move"]],
    [
      "--confirm",
      args.confirm,
      ["complete", "discard", "delete", "merge-local", "choose-variant", "check-loop"],
    ],
    ["--squash", args.squash, ["merge-local"]],
    ["--estimate", args.estimate, ["update"]],
    ["--validation-note", args.validationNote, ["update"]],
    ["--spec-path", args.specPath, ["update"]],
    ["--blocked-by", args.blockedBy, ["update"]],
    ["--language", args.language, ["review"]],
  ];
  for (const [flag, value, actions] of flagged) {
    if (value === undefined) continue;
    // `--language` also belongs to `persona`, which checks its own flags below.
    if (["--language", "--description", "--confirm"].includes(flag) && args.command === "persona")
      continue;
    // `--confirm` is also `team new`'s, which checks its own flags below.
    if (flag === "--confirm" && args.command === "team") continue;
    if (args.command !== "card")
      throw new Error(`${flag}: this flag only applies to flightdeckd card\n${USAGE}`);
    if (!actions?.includes(args.action as string))
      throw new Error(
        `${flag}: this flag only applies to flightdeckd card ${(actions ?? []).join(", ")}\n${USAGE}`,
      );
  }
  if (args.rounds !== undefined && args.loop === "off")
    throw new Error(`--rounds: only with check-loop on\n${USAGE}`);
  // `team update` takes its goal as a flag, `team new` as its operand: the flag is refused on the rest.
  if (args.command === "team" && args.action === "update") args.teamGoal = args.teamGoalFlag;
  const fault = personaProblem(args) ?? teamProblem(args) ?? boardProblem(args);
  if (fault !== undefined) throw new Error(`${fault}\n${USAGE}`);
  delete args.titleFlag;
  return args;
}

/** The options that take a value (`--project p`): a reader of the command text must skip that value. */
export const VALUE_FLAGS = Object.keys(HANDLERS).filter(
  (name) =>
    name.startsWith("--") &&
    !["--help", "--version"].includes(name) &&
    !FLAGS.has(HANDLERS[name] as Handler),
);
