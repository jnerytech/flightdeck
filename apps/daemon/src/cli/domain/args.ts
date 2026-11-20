/**
 * The `flightdeckd` command line (issue #1593): its words, flags and usage, parsed into `CliArgs`
 * with no effect; `main.ts` runs what they ask for.
 */
import { RuntimeKind } from "../../config.ts";

export type ServiceAction = "install" | "uninstall" | "status" | "stop" | "start";

export interface CliArgs {
  command:
    | "start"
    | "pair"
    | "setup"
    | "doctor"
    | "service"
    | "history"
    | "approvers"
    | "hooks"
    | "telemetry"
    | "hook"
    | "channel"
    | "claude"
    | "help"
    | "askpass"
    | "mcp"
    | "statusline"
    | "action"
    | "snippet"
    | "message"
    | "card"
    | "persona"
    | "host"
    | "sessions"
    | "requests"
    | "send"
    | "approve"
    | "deny"
    | "version"
    | "db"
    | "backup"
    | "restore"
    | "update";
  /** `service <action>`, `hooks <action>`, `history reindex` or `action list|run`. */
  action?:
    | ServiceAction
    | "reindex"
    | "enroll"
    | "reset"
    | "list"
    | "run"
    | "get"
    | "send"
    | "idle"
    | "read"
    | "team"
    | "show"
    | "new"
    | "start"
    | "move"
    | "update"
    | "stop"
    | "complete"
    | "delete"
    | "discard"
    | "subagents"
    | "save"
    | "remove"
    | "publish-agent"
    | "diff"
    | "spec"
    | "review"
    | "message"
    | "templates"
    | "validation-template"
    | "pr-create"
    | "update-from-base"
    | "merge-local"
    | "arena"
    | "start-arena"
    | "choose-variant"
    | "check-loop"
    | "dismiss-unblocked";
  /** `message send <to> <text>`. */
  to?: string;
  text?: string;
  /** `message idle|read <session>`, with `--last N` for read; `requests --session`. */
  session?: string;
  /** `--host <name>`: ask the paired host of that name instead of this machine's daemon (#3429). */
  host?: string;
  /** `send <session> <text>`: the session that gets the text, its name or its id. */
  sendTo?: string;
  /** `approve|deny <request>`: the id of the permission request. */
  requestId?: string;
  /** `approve|deny --message`: what the answer tells Claude. */
  answerMessage?: string;
  /** `approve --hold`: accepted for older scripts; it sends nothing, a high-risk allow is made in the app (#3439). */
  hold?: boolean;
  last?: number;
  /** `message team <team>`. */
  team?: string;
  /** `action ... --project <id>`, `card ... --project <name or id>`. */
  project?: string;
  /** `card show|start <card>` and `card new <title>`; `card new --description <text>`; `card start --workflow <name>`; `--json`. */
  cardId?: string;
  cardTitle?: string;
  /** `card move <card> <column> [--position n] [--force]`, `card complete|discard|delete --confirm`, `card update --estimate ... --blocked-by ...`. */
  column?: string;
  /** `--title`, until the end of the arguments says whether the action takes it. */
  titleFlag?: string;
  position?: number;
  force?: true;
  confirm?: true;
  squash?: true;
  /** `card start-arena --variant ...` (repeats); `card choose-variant <card> <variant>`; `card check-loop <card> on|off --rounds n`. */
  variants?: string[];
  variant?: string;
  loop?: "on" | "off";
  rounds?: number;
  estimate?: string;
  validationNote?: string;
  specPath?: string;
  blockedBy?: string;
  description?: string;
  workflow?: string;
  /** `card review` and `persona list|show|subagents`: the language of the text. */
  language?: "en" | "pt-BR";
  json?: true;
  /** `persona show|save|remove|reset|publish-agent <id>`. */
  personaId?: string;
  /** `persona save`: the persona's fields, as flags. */
  personaName?: string;
  body?: string;
  bodyFile?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  tools?: string[];
  permissionMode?: string;
  icon?: string;
  /** `persona list --scope <host|project|all>`. */
  scope?: "host" | "project" | "all";
  /** `action run <name>`. */
  actionName?: string;
  /** `snippet get <name>` (phase 18). */
  snippetName?: string;
  /** `snippet ... --project-path <path>`: the project whose snippets count too. */
  projectPath?: string;
  /** `snippet list --query <text>`. */
  query?: string;
  /** `action run ... --param k=v`, repeatable. */
  params?: Record<string, string>;
  /** `service ... --dry-run`: print, change nothing. */
  dryRun?: true;
  config?: string;
  runtime?: RuntimeKind;
  /** `pair --rotate`: generate a new token first. */
  rotate?: true;
  /** `setup --yes --folders a,b`: no questions, the folders come from here. */
  yes?: true;
  folders?: string[];
  /** `hook session-start --url <receptor> --token <hooks.token>`, as `hooks install` writes it. */
  url?: string;
  token?: string;
  /** `channel --launch <id>`: the `flightdeckd claude` launch this channel serves. */
  launch?: string;
  /** `backup --out <file>`. */
  out?: string;
  /** `restore <file>`. */
  file?: string;
  /** `update --from <binary> [--allow-downgrade]`. */
  from?: string;
  allowDowngrade?: true;
  /** `claude [args]`: everything after `claude` belongs to the real claude. */
  claudeArgs?: string[];
  /** `askpass <prompt...>`: what ssh is asking for. */
  askpassPrompt?: string;
}

export const USAGE = [
  "usage: flightdeckd [start] [--config <file>] [--runtime fake|claude]",
  "     fd --version | --help",
  "     fd db prune [--dry-run] [--config <file>]",
  "     fd backup [--out <file>] [--config <file>]",
  "     fd restore <file> [--config <file>]   (with the daemon stopped)",
  "     fd update --from <binary> [--allow-downgrade] [--config <file>]",
  "     fd setup [--yes --folders <a,b>] [--config <file>]   (guided first run)",
  "     fd doctor [--config <file>]   (what is missing for it to work, and how to fix it)",
  "     fd pair [--rotate] [--config <file>]",
  "     fd service install|uninstall|status|stop|start [--dry-run] [--config <file>]",
  "     fd history reindex [--config <file>]",
  "     fd approvers enroll [--json] [--config <file>]   (this host's terminal opens the window that enrolls the first device)",
  "     fd approvers reset [--json] [--config <file>]   (removes every enrolled device)",
  "     fd hooks install|uninstall|status [--config <file>]",
  "     fd telemetry install|uninstall|status [--config <file>]",
  "     flightdeckd hook session-start --url <receiver> --token <token>   (called by Claude Code)",
  "     flightdeckd channel --launch <id> --url <receiver> --token <token>   (the channel's MCP server)",
  "     fd [claude arguments]   (a bare fd is flightdeckd claude: claude with the Flightdeck channel; config in FLIGHTDECK_CONFIG)",
  "     fd claude <prompt>      (a prompt or a claude command that starts with a word above, such as update or doctor)",
  "     flightdeckd claude [claude arguments]   (the same, by its full name)",
  "     fd architect|reviewer|security|coordinator [claude arguments]   (claude with that persona)",
  "     fd new <persona> [claude arguments]   (claude with any persona, by its id)",
  "     flightdeckd askpass <prompt>   (called by ssh through SSH_ASKPASS; config in FLIGHTDECK_CONFIG)",
  "     fd mcp [--config <file>]   (stdio MCP server for this host's Claude Code)",
  "     fd statusline [--config <file>]   (one line for Claude Code's statusline)",
  "     fd message list|send <to> <text>|idle <session>|read <session> [--last N]|team <team>",
  "     fd card list [--project <name or id>] [--json] [--config <file>]",
  "     fd card show <card> [--json] [--config <file>]",
  "     fd card new <title> [--project <name or id>] [--description <text>] [--json] [--config <file>]",
  "     fd card start <card> [--workflow <name>] [--json] [--config <file>]",
  "     fd card move <card> <column> [--position <n>] [--force] [--json] [--config <file>]",
  "     fd card update <card> [--title <text>] [--description <text>] [--estimate <hours|none>] [--validation-note <text|none>] [--spec-path <path|none>] [--blocked-by <ids|none>] [--json] [--config <file>]",
  "     fd card stop <card> [--json] [--config <file>]",
  "     fd card complete|discard|delete <card> --confirm [--json] [--config <file>]   (they cannot be undone)",
  "     fd persona list [--scope host|project|all] [--project-path <folder>] [--language en|pt-BR] [--json] [--config <file>]",
  "     fd persona show <id> [--project-path <folder>] [--language en|pt-BR] [--json] [--config <file>]",
  "     fd persona subagents [--project-path <folder>] [--language en|pt-BR] [--json] [--config <file>]",
  "     fd card diff <card> [--json] [--config <file>]",
  "     fd card spec <card> [--json] [--config <file>]",
  "     fd card review <card> [--language en|pt-BR] [--json] [--config <file>]",
  "     fd card message <card> <text> [--json] [--config <file>]",
  "     fd card templates [--project <name or id>] [--json] [--config <file>]",
  "     fd card validation-template <card> [--json] [--config <file>]",
  "     fd card pr-create <card> [--title <text>] [--description <text>] [--json] [--config <file>]",
  "     fd card update-from-base <card> [--json] [--config <file>]",
  "     fd card merge-local <card> --confirm [--squash] [--message <text>] [--json] [--config <file>]",
  "     fd card arena <card> [--json] [--config <file>]",
  "     fd card start-arena <card> --variant <model[:effort[:persona]]> --variant <...> [--variant <...>] [--workflow <name>] [--json] [--config <file>]   (2 to 4 variants)",
  "     fd card choose-variant <card> <variant> --confirm [--json] [--config <file>]   (keeps that variant, removes the others)",
  "     fd card check-loop <card> on|off [--rounds <1 to 10>] [--confirm] [--json] [--config <file>]",
  "     fd card dismiss-unblocked <card> [--json] [--config <file>]",
  "     fd host [--host <name>] [--json] [--config <file>]   (what a daemon reports about itself: this host's, or a paired host's)",
  "     fd sessions [--host <name>] [--json] [--config <file>]   (the sessions of a daemon: this host's, or a paired host's)",
  "     fd send <session> <text> [--host <name>] [--json] [--config <file>]   (the session is its name or its id)",
  "     fd approve <request> [--message <text>] [--hold] [--host <name>] [--json] [--config <file>]   (a high-risk request is approved in the app; --hold is accepted and does nothing)",
  "     fd deny <request> [--message <text>] [--host <name>] [--json] [--config <file>]",
  "     fd requests [--session <session>] [--host <name>] [--json] [--config <file>]   (the open permission requests, oldest first)",
  "     fd action list [--project <id>] [--config <file>]",
  "     fd action run <name> [--project <id>] [--param key=value ...] [--config <file>]",
  "     fd snippet list [--project-path <folder>] [--query <text>] [--config <file>]",
  "     fd snippet get <name> [--project-path <folder>] [--config <file>]",
].join("\n");

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
  persona: (args, reader) => {
    args.command = "persona";
    const action = subAction(
      reader,
      ["list", "show", "subagents", "save", "remove", "reset", "publish-agent"],
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
  "--variant": setValue((args, v) => {
    args.variants = [...(args.variants ?? []), v];
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

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"];

/** The flags of `persona`, each with the verbs that take it (`--language` is checked by the daemon). */
function personaFlags(args: CliArgs): Array<[string, unknown, readonly string[]]> {
  return [
    ["--scope", args.scope, ["list", "save", "remove"]],
    ["--name", args.personaName, ["save"]],
    ["--body", args.body, ["save"]],
    ["--body-file", args.bodyFile, ["save"]],
    ["--model", args.model, ["save"]],
    ["--effort", args.effort, ["save"]],
    ["--tools", args.tools, ["save"]],
    ["--permission-mode", args.permissionMode, ["save"]],
    ["--icon", args.icon, ["save"]],
    // `--description` and `--confirm` are the card's too: only `persona` is checked here.
    ...(args.command === "persona"
      ? ([
          ["--description", args.description, ["save"]],
          ["--confirm", args.confirm, ["publish-agent"]],
        ] as Array<[string, unknown, readonly string[]]>)
      : []),
  ];
}

/** What `persona` verbs need before anything is sent: the flags of the verb, and the ones it cannot do without. */
function checkPersona(args: CliArgs): void {
  for (const [flag, value, verbs] of personaFlags(args)) {
    if (value === undefined) continue;
    if (args.command !== "persona" || !verbs.includes(args.action as string))
      throw new Error(
        `${flag}: this flag only applies to flightdeckd persona ${verbs.join(", ")}\n${USAGE}`,
      );
  }
  if (args.command !== "persona") return;
  const missing = (flag: string) => new Error(`missing ${flag}\n${USAGE}`);
  if (args.action === "save" || args.action === "remove") {
    if (args.scope === undefined) throw missing("--scope");
    if (args.scope === "all") throw new Error(`--scope: host or project\n${USAGE}`);
  }
  if (args.action === "save") {
    if (args.personaName === undefined) throw missing("--name");
    if (args.description === undefined) throw missing("--description");
    if (args.body === undefined && args.bodyFile === undefined)
      throw missing("--body or --body-file");
    if (args.body !== undefined && args.bodyFile !== undefined)
      throw new Error(`--body or --body-file, not both\n${USAGE}`);
  }
  if (args.action === "publish-agent" && args.projectPath === undefined)
    throw missing("--project-path");
}

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
      "persona",
      "host",
      "sessions",
      "requests",
      "send",
      "approve",
      "deny",
      "approvers",
    ].includes(args.command)
  )
    throw new Error(
      `--json: this flag only applies to flightdeckd card, persona, host, sessions, requests, send, approve, deny and approvers\n${USAGE}`,
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
  if (!["requests", "message"].includes(args.command) && args.session !== undefined)
    throw new Error(
      `--session: this flag only applies to flightdeckd requests and message\n${USAGE}`,
    );
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
    if (args.command !== "card")
      throw new Error(`${flag}: this flag only applies to flightdeckd card\n${USAGE}`);
    if (!actions?.includes(args.action as string))
      throw new Error(
        `${flag}: this flag only applies to flightdeckd card ${(actions ?? []).join(", ")}\n${USAGE}`,
      );
  }
  if (args.rounds !== undefined && args.loop === "off")
    throw new Error(`--rounds: only with check-loop on\n${USAGE}`);
  checkPersona(args);
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
