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
    | "hooks"
    | "telemetry"
    | "hook"
    | "channel"
    | "claude"
    | "askpass"
    | "mcp"
    | "statusline"
    | "action"
    | "snippet"
    | "message"
    | "card"
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
    | "list"
    | "run"
    | "get"
    | "send"
    | "idle"
    | "read"
    | "team"
    | "show"
    | "new"
    | "start";
  /** `message send <to> <text>`. */
  to?: string;
  text?: string;
  /** `message idle|read <session>`, with `--last N` for read; `requests --session`. */
  session?: string;
  /** `send <session> <text>`: the session that gets the text, its name or its id. */
  sendTo?: string;
  /** `approve|deny <request>`: the id of the permission request. */
  requestId?: string;
  /** `approve|deny --message`: what the answer tells Claude. */
  answerMessage?: string;
  /** `approve --hold`: the Approve was held, the proof a high-risk request needs. */
  hold?: boolean;
  last?: number;
  /** `message team <team>`. */
  team?: string;
  /** `action ... --project <id>`, `card ... --project <name or id>`. */
  project?: string;
  /** `card show|start <card>` and `card new <title>`; `card new --description <text>`; `card start --workflow <name>`; `--json`. */
  cardId?: string;
  cardTitle?: string;
  description?: string;
  workflow?: string;
  json?: true;
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

const USAGE = [
  "usage: flightdeckd [start] [--config <file>] [--runtime fake|claude]",
  "     flightdeckd --version",
  "     flightdeckd db prune [--dry-run] [--config <file>]",
  "     flightdeckd backup [--out <file>] [--config <file>]",
  "     flightdeckd restore <file> [--config <file>]   (with the daemon stopped)",
  "     flightdeckd update --from <binary> [--allow-downgrade] [--config <file>]",
  "     flightdeckd setup [--yes --folders <a,b>] [--config <file>]   (guided first run)",
  "     flightdeckd doctor [--config <file>]   (what is missing for it to work, and how to fix it)",
  "     flightdeckd pair [--rotate] [--config <file>]",
  "     flightdeckd service install|uninstall|status|stop|start [--dry-run] [--config <file>]",
  "     flightdeckd history reindex [--config <file>]",
  "     flightdeckd hooks install|uninstall|status [--config <file>]",
  "     flightdeckd telemetry install|uninstall|status [--config <file>]",
  "     flightdeckd hook session-start --url <receiver> --token <token>   (called by Claude Code)",
  "     flightdeckd channel --launch <id> --url <receiver> --token <token>   (the channel's MCP server)",
  "     flightdeckd claude [claude arguments]   (config in FLIGHTDECK_CONFIG)",
  "     flightdeckd askpass <prompt>   (called by ssh through SSH_ASKPASS; config in FLIGHTDECK_CONFIG)",
  "     flightdeckd mcp [--config <file>]   (stdio MCP server for this host's Claude Code)",
  "     flightdeckd statusline [--config <file>]   (one line for Claude Code's statusline)",
  "     flightdeckd message list|send <to> <text>|idle <session>|read <session> [--last N]|team <team>",
  "     flightdeckd card list [--project <name or id>] [--json] [--config <file>]",
  "     flightdeckd card show <card> [--json] [--config <file>]",
  "     flightdeckd card new <title> [--project <name or id>] [--description <text>] [--json] [--config <file>]",
  "     flightdeckd card start <card> [--workflow <name>] [--json] [--config <file>]",
  "     flightdeckd host [--json] [--config <file>]   (what this host's daemon reports about itself)",
  "     flightdeckd sessions [--json] [--config <file>]   (the sessions of this host's daemon)",
  "     flightdeckd send <session> <text> [--json] [--config <file>]   (the session is its name or its id)",
  "     flightdeckd approve <request> [--message <text>] [--hold] [--json] [--config <file>]   (--hold: you mean to allow a high-risk request; it is your own assertion)",
  "     flightdeckd deny <request> [--message <text>] [--json] [--config <file>]",
  "     flightdeckd requests [--session <session>] [--json] [--config <file>]   (the open permission requests, oldest first)",
  "     flightdeckd action list [--project <id>] [--config <file>]",
  "     flightdeckd action run <name> [--project <id>] [--param key=value ...] [--config <file>]",
  "     flightdeckd snippet list [--project-path <folder>] [--query <text>] [--config <file>]",
  "     flightdeckd snippet get <name> [--project-path <folder>] [--config <file>]",
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
    const action = subAction(reader, ["list", "show", "new", "start"], "invalid card action");
    args.action = action;
    if (action === "show" || action === "start") args.cardId = operand(reader, "the card");
    if (action === "new") args.cardTitle = operand(reader, "the title");
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
  "--hold": setFlag((args) => {
    args.hold = true;
  }),
  "--session": setValue((args, v) => {
    args.session = v;
  }),
  "--json": setFlag((args) => {
    args.json = true;
  }),
  "--description": setValue((args, v) => {
    args.description = v;
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
    !["card", "host", "sessions", "requests", "send", "approve", "deny"].includes(args.command)
  )
    throw new Error(
      `--json: this flag only applies to flightdeckd card, host, sessions, requests, send, approve and deny\n${USAGE}`,
    );
  if (args.hold && args.command !== "approve")
    throw new Error(`--hold: this flag only applies to flightdeckd approve\n${USAGE}`);
  if (args.answerMessage !== undefined && !["approve", "deny"].includes(args.command))
    throw new Error(`--message: this flag only applies to flightdeckd approve and deny\n${USAGE}`);
  if (!["requests", "message"].includes(args.command) && args.session !== undefined)
    throw new Error(`--session: this flag only applies to flightdeckd requests and message\n${USAGE}`);
  if (args.command !== "card" && (args.description !== undefined || args.workflow !== undefined))
    throw new Error(
      `--description and --workflow: this flag only applies to flightdeckd card\n${USAGE}`,
    );
  return args;
}
