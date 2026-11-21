/**
 * The `flightdeckd` command line (issue #1593): its words, flags and usage, parsed into `CliArgs`
 * with no effect; `main.ts` runs what they ask for.
 */
import { RuntimeKind } from "../../config.ts";
import { ACTION_FLAGS, actionProblem, readAction } from "./action-args.ts";
import { AGENTCFG_FLAGS, agentcfgProblem, readAgentcfg } from "./agentcfg-args.ts";
import { approversProblem } from "./approvers-args.ts";
import { ArgReader, FLAGS, operand, subAction } from "./arg-reader.ts";
import { AUTOMATION_FLAGS, automationProblem, readAutomation } from "./automation-args.ts";
import { boardProblem } from "./board-args.ts";
import { BOARDSYNC_FLAGS, boardsyncProblem, readBoardsync } from "./boardsync-args.ts";
import { BUDGET_FLAGS, budgetProblem, takeBudgetAction } from "./budget-args.ts";
import { refuseCardFlags } from "./card-args.ts";
import { CHANGES_FLAGS, changesProblem, readChanges, takeChangesFlags } from "./changes-args.ts";
import {
  CHECKPOINT_FLAGS,
  checkpointsProblem,
  readRewind,
  readSnapshots,
  readTrace,
} from "./checkpoints-args.ts";
import type { CliArgs, ServiceAction } from "./cli-args.ts";
import { HOST_COMMANDS, JSON_COMMANDS, refuseOutside } from "./command-sets.ts";
import { costsProblem } from "./costs-args.ts";
import { FILE_FLAGS, fileProblem, readFile, takeFileFlags } from "./file-args.ts";
import { type Handler, setFlag, setValue } from "./flag-handlers.ts";
import { historyProblem, readHistory } from "./history-args.ts";
import { readKnowledge } from "./knowledge-args.ts";
import { mcpProblem, readMcp, takeMcpFlags } from "./mcp-args.ts";
import { memoryProblem, readMemory } from "./memory-args.ts";
import { MESSAGE_ADMIN_VERBS, MESSAGE_FLAGS, messageProblem } from "./message-args.ts";
import { EFFORTS, PERMISSION_MODES, personaProblem } from "./persona-args.ts";
import { PLUGINS_FLAGS, pluginsProblem, readPlugins } from "./plugins-args.ts";
import { PROJECT_FLAGS, projectProblem, readProject } from "./project-args.ts";
import { parseShare, quotaProblem, wholeFrom } from "./quota-args.ts";
import { REVIEW_FLAGS, readReview, reviewProblem } from "./review-args.ts";
import { rulesProblem } from "./rules-args.ts";
import { readRunenv, runenvProblem } from "./runenv-args.ts";
import { readSession, sessionProblem, takeSessionFlags } from "./session-args.ts";
import { OFF_FLAG, readSnippet, SNIPPET_FLAGS, snippetProblem } from "./snippet-args.ts";
import { readSsh, SSH_FLAGS, sshProblem } from "./ssh-args.ts";
import { teamProblem } from "./team-args.ts";
import {
  readTerminal,
  TERMINAL_FLAGS,
  takeTerminalFlags,
  terminalProblem,
} from "./terminal-args.ts";
import { USAGE } from "./usage.ts";
import { atTime, oneOf, readVault, vaultProblem } from "./vault-args.ts";
import { readWatch, takeWatchFlags, WATCH_FLAGS, watchProblem } from "./watch-args.ts";

export type { CliArgs, ServiceAction } from "./cli-args.ts";
export { USAGE } from "./usage.ts";

const SERVICE_ACTIONS: readonly ServiceAction[] = [
  "install",
  "uninstall",
  "status",
  "stop",
  "start",
];

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

/** The command word is the first one: a second would replace it and keep the first one's operands. */
function startCommand(args: CliArgs, command: CliArgs["command"]): void {
  if (args.command !== "start")
    throw new Error(`one command at a time: ${args.command}, then ${command}\n${USAGE}`);
  args.command = command;
}

/** The words of `fd` that are not subcommands but are still Flightdeck's own. */
const FD_FLAGS = new Set(["--version", "--help", "-h"]);

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
  mcp: readMcp,
  knowledge: readKnowledge,
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
    if (own || FD_FLAGS.has(word)) Object.assign(args, parseArgs(rest));
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
  history: readHistory,
  vault: readVault,
  plugins: readPlugins,
  project: readProject,
  approvers: withAction("approvers", ["enroll", "reset", "watch"], "invalid approvers action"),
  rules: (args, reader) => {
    args.command = "rules";
    const action = subAction(reader, ["list", "remove"] as const, "invalid rules action");
    args.action = action;
    // The rule is the text the project holds, as `rules list` printed it: an operand, never a flag.
    if (action === "remove") args.rule = operand(reader, "rule");
  },
  autoapprove: withAction("autoapprove", ["list", "resume"], "invalid autoapprove action"),
  action: readAction,
  snippet: readSnippet,
  message: (args, reader) => {
    args.command = "message";
    const action = subAction(
      reader,
      ["list", "send", "idle", "read", "team", ...MESSAGE_ADMIN_VERBS],
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
      [
        "list",
        "show",
        "new",
        "update",
        "delete",
        "add-member",
        "remove-member",
        "pause",
        "resume",
        "close",
        "message",
      ],
      "invalid team action",
    );
    args.action = action;
    if (action !== "list" && action !== "new") args.teamId = operand(reader, "the team");
    if (action === "new") args.teamGoal = operand(reader, "the goal");
    if (action === "remove-member") args.teamMember = operand(reader, "the member");
    if (action === "message") args.teamText = operand(reader, "the text");
    if (action === "add-member") {
      const next = reader.peek();
      if (next && !next.startsWith("--")) args.teamSpec = reader.next();
    }
  },
  budget: (args, reader) => {
    args.command = "budget";
    const action = subAction(
      reader,
      ["list", "set", "set-quota", "remove", "watch"],
      "invalid budget action",
    );
    args.action = action;
    if (action === "remove") {
      // An --id given before the verb names a second budget.
      if (args.budgetId !== undefined)
        throw new Error(
          `--id: this flag only applies to flightdeckd budget set and set-quota\n${USAGE}`,
        );
      args.budgetId = operand(reader, "the budget");
      if (args.budgetId.trim() === "") throw new Error(`missing the budget\n${USAGE}`);
    }
  },
  quota: (args, reader) => {
    args.command = "quota";
    const verbs = ["get", "history", "pause-at", "watch"] as const;
    const action = subAction(reader, verbs, "invalid quota action");
    args.action = action;
    if (action === "history") args.quotaWindow = operand(reader, "the window");
    if (action === "pause-at") {
      const share = parseShare(operand(reader, "the share"));
      if (share === undefined)
        throw new Error(`quota pause-at: a share from 0 to 1, or off\n${USAGE}`);
      args.quotaPauseAt = share;
    }
  },
  usage: setCommand("usage"),
  costs: (args, reader) => {
    args.command = "costs";
    const verbs = ["summary", "session", "card", "run", "status", "export", "reprice"] as const;
    const action = subAction(reader, verbs, "invalid costs action");
    args.action = action;
    if (action === "session") args.costsId = operand(reader, "the session");
    if (action === "card") args.costsId = operand(reader, "the card");
    if (action === "run") args.costsId = operand(reader, "the run");
  },
  roi: setCommand("roi"),
  "--hours": setValue((args, v) => {
    args.hours = wholeFrom("--hours", v, 720);
  }),
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
  session: readSession,
  ssh: readSsh,
  watch: readWatch,
  boardsync: readBoardsync,
  review: readReview,
  memory: readMemory,
  runenv: readRunenv,
  changes: readChanges,
  snapshots: readSnapshots,
  rewind: readRewind,
  trace: readTrace,
  file: readFile,
  automation: readAutomation,
  terminal: readTerminal,
  agentcfg: readAgentcfg,
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
  "--follow": setFlag((args) => {
    args.follow = true;
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
  "--to": setValue((args, v) => {
    args.until = v;
  }),
  "--cwd": setValue((args, v) => {
    args.cwd = v;
  }),
  "--project-key": setValue((args, v) => {
    args.projectKey = v;
  }),
  "--origin": setValue((args, v) => {
    args.origin = v as CliArgs["origin"];
  }),
  "--cursor": setValue((args, v) => {
    args.cursor = v;
  }),
  "--hide-automated": setFlag((args) => {
    args.hideAutomated = true;
  }),
  "--tail": setFlag((args) => {
    args.tail = true;
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
  ...BUDGET_FLAGS,
  ...ACTION_FLAGS,
  ...AUTOMATION_FLAGS,
  ...PLUGINS_FLAGS,
  ...SNIPPET_FLAGS,
  ...SSH_FLAGS,
  ...TERMINAL_FLAGS,
  ...WATCH_FLAGS,
  ...BOARDSYNC_FLAGS,
  ...REVIEW_FLAGS,
  ...CHANGES_FLAGS,
  ...CHECKPOINT_FLAGS,
  ...FILE_FLAGS,
  "--off": OFF_FLAG,
  ...PROJECT_FLAGS,
  ...AGENTCFG_FLAGS,
  ...MESSAGE_FLAGS,
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
  // `usage` keeps at most 90 days; `vault decisions` and `vault report` take up to a year.
  "--days": setValue((args, v) => {
    if (args.command === "usage") {
      args.days = wholeFrom("--days", v, 90);
      return;
    }
    const n = Number(v);
    if (!/^\d+$/.test(v) || n < 1 || n > 365)
      throw new Error(`--days: a whole number from 1 to 365, got ${v}\n${USAGE}`);
    args.days = n;
  }),
  "--csv": setFlag((args) => {
    args.csv = true;
  }),
  "--requester": setValue((args, v) => {
    args.requester = oneOf("--requester", v, ["you", "claude", "automation", "workflow"]);
  }),
  "--purpose": setValue((args, v) => {
    args.purpose = oneOf("--purpose", v, ["ssh", "action", "run_with_secret"]);
  }),
  "--action": setValue((args, v) => {
    args.useAction = v;
  }),
  "--tag": setValue((args, v) => {
    args.tags = [...(args.tags ?? []), v];
  }),
  "--risk": setValue((args, v) => {
    args.risk = oneOf("--risk", v, ["low", "medium", "high"]);
  }),
  "--approval": setValue((args, v) => {
    args.approval = oneOf("--approval", v, ["always", "never", "first-per-session"]);
  }),
  "--at": setValue((args, v) => {
    args.at = atTime(v);
  }),
  "--dir": setValue((args, v) => {
    args.pluginDir = v;
  }),
  "--config": setValue((args, v) => {
    args.config = v;
  }),
  "--runtime": setValue((args, v) => {
    args.runtime = RuntimeKind.parse(v);
  }),
  "--prompt": setValue((args, v) => {
    args.sessionStart = { ...args.sessionStart, prompt: v };
  }),
  "--up-to": setValue((args, v) => {
    args.sessionStart = { ...args.sessionStart, upToMessageId: v };
  }),
  "--open": setValue((args, v) => {
    if (v !== "flightdeck" && v !== "terminal")
      throw new Error(`--open: flightdeck or terminal\n${USAGE}`);
    args.sessionStart = { ...args.sessionStart, open: v };
  }),
};

/** One word of the command line: its flag, an inline `=value` if any, and the handler that applies it. */
function takeOption(args: CliArgs, reader: ArgReader, arg: string): void {
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
  // A second command word would re-target the parse, past the risk rating of the first (`fd` has its own refusal).
  if (!flag.startsWith("--") && flag !== "fd" && args.command !== "start")
    throw new Error(`one command at a time: ${args.command}, then ${flag}\n${USAGE}`);
  if (inline !== undefined && FLAGS.has(handler))
    throw new Error(`${flag} needs no value\n${USAGE}`);
  handler(args, reader, value);
}

/** The flags that only some commands take, refused on the rest (the per-command files check their own). */
function refuseStrayFlags(args: CliArgs): void {
  if (args.json) refuseOutside("--json", JSON_COMMANDS, args.command);
  if (args.host !== undefined) refuseOutside("--host", HOST_COMMANDS, args.command);
  if (args.plain) refuseOutside("--plain", ["action"], args.command);
  if (args.hold && args.command !== "approve")
    throw new Error(`--hold: this flag only applies to flightdeckd approve\n${USAGE}`);
  if (
    args.answerMessage !== undefined &&
    !["approve", "deny"].includes(args.command) &&
    !(args.command === "card" && args.action === "merge-local") &&
    args.command !== "changes"
  )
    throw new Error(
      `--message: this flag only applies to flightdeckd approve and deny, and to card merge-local\n${USAGE}`,
    );
  takeTerminalFlags(args);
  takeChangesFlags(args);
  takeFileFlags(args);
  takeWatchFlags(args);
  takeMcpFlags(args);
  if (
    !["requests", "message", "autoapprove", "vault", "mcp"].includes(args.command) &&
    args.session !== undefined
  )
    throw new Error(
      `--session: this flag only applies to flightdeckd requests, message, autoapprove, vault and mcp toggle\n${USAGE}`,
    );
  // `history`, `vault`, `snippet`, `automation` and `action` check their own limits (history-args.ts, vault-args.ts, snippet-args.ts, automation-args.ts, action-args.ts).
  if (
    !["autoapprove", "history", "vault", "snippet", "message", "automation", "action"].includes(
      args.command,
    ) &&
    args.limit !== undefined
  )
    throw new Error(
      `--limit: this flag only applies to flightdeckd autoapprove, history, message, vault, snippet, automation runs and action runs\n${USAGE}`,
    );
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { command: "start" };
  const reader = new ArgReader(argv);
  for (let arg = reader.current(); arg !== undefined; reader.advance(), arg = reader.current())
    takeOption(args, reader, arg);
  refuseStrayFlags(args);
  // `card new` takes its title as an operand: the flag is the title of an update.
  if (args.titleFlag !== undefined && ["update", "pr-create"].includes(args.action as string))
    args.cardTitle = args.titleFlag;
  takeSessionFlags(args);
  refuseCardFlags(args);
  if (args.rounds !== undefined && args.loop === "off")
    throw new Error(`--rounds: only with check-loop on\n${USAGE}`);
  // `team update` takes its goal as a flag, `team new` as its operand: the flag is refused on the rest.
  if (args.command === "team" && args.action === "update") args.teamGoal = args.teamGoalFlag;
  takeBudgetAction(args);
  const fault =
    personaProblem(args) ??
    sessionProblem(args) ??
    teamProblem(args) ??
    boardProblem(args) ??
    historyProblem(args) ??
    vaultProblem(args) ??
    pluginsProblem(args) ??
    snippetProblem(args) ??
    sshProblem(args) ??
    terminalProblem(args) ??
    agentcfgProblem(args) ??
    messageProblem(args) ??
    mcpProblem(args) ??
    watchProblem(args) ??
    boardsyncProblem(args) ??
    reviewProblem(args) ??
    memoryProblem(args) ??
    runenvProblem(args) ??
    changesProblem(args) ??
    checkpointsProblem(args) ??
    fileProblem(args) ??
    actionProblem(args) ??
    automationProblem(args) ??
    projectProblem(args) ??
    quotaProblem(args) ??
    budgetProblem(args) ??
    rulesProblem(args) ??
    approversProblem(args) ??
    costsProblem(args);
  if (fault !== undefined) throw new Error(`${fault}\n${USAGE}`);
  delete args.titleFlag;
  return args;
}

/** The options that take a value (`--project p`): a reader of the command text must skip that value. */
export const VALUE_FLAGS = Object.keys(HANDLERS).filter(
  (name) =>
    name.startsWith("--") &&
    !["--help", "--version", "--"].includes(name) &&
    !FLAGS.has(HANDLERS[name] as Handler),
);
