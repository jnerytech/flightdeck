/** The words of the `flightdeckd` command line, parsed (issue #1593): what `parseArgs` returns. */
import type { VaultRequester } from "@flightdeck/protocol";
import type { RuntimeKind } from "../../config.ts";

export type ServiceAction = "install" | "uninstall" | "status" | "stop" | "start";

export interface CliArgs {
  command:
    | "start"
    | "pair"
    | "setup"
    | "doctor"
    | "service"
    | "history"
    | "vault"
    | "approvers"
    | "rules"
    | "autoapprove"
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
    | "team"
    | "persona"
    | "board"
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
    | "settings"
    | "watch"
    | "subagents"
    | "save"
    | "remove"
    | "resume"
    | "publish-agent"
    | "trust"
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
    | "add-member"
    | "pause"
    | "resume"
    | "close"
    | "message"
    | "remove-member"
    | "dismiss-unblocked"
    | "search"
    | "tool"
    | "resume"
    | "decisions"
    | "report"
    | "rules"
    | "preview";
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
  /** `team show <team>`. */
  teamId?: string;
  /** `team new <goal> --workers N | --worker <spec>... [--coordinator <spec>] [--check <command>...]`; `--name` is `personaName`, `--confirm` is `confirm`. */
  teamGoal?: string;
  teamWorkers?: number;
  teamWorkerSpecs?: string[];
  teamCoordinator?: string;
  teamChecks?: string[];
  teamGoalFlag?: string;
  teamText?: string;
  teamMember?: string;
  teamSpec?: string;
  teamPersona?: string;
  teamClearChecks?: boolean;
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
  /** `approvers watch --follow`. */
  follow?: true;
  squash?: true;
  /** `card start-arena --variant ...` (repeats); `card choose-variant <card> <variant>`; `card check-loop <card> on|off --rounds n`. */
  variants?: string[];
  variant?: string;
  loop?: "on" | "off";
  rounds?: number;
  /** `board settings --max-parallel-runs`. */
  maxParallelRuns?: number;
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
  /** `rules remove <rule>`: the rule, as `rules list` printed it. */
  rule?: string;
  body?: string;
  bodyFile?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  tools?: string[];
  permissionMode?: string;
  icon?: string;
  /** `autoapprove list --limit` and `history list|search|get --limit`: how many to read. */
  limit?: number;
  /** `persona trust --hash`: the start of the hash `persona list` showed. */
  hash?: string;
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
  /** `update --from <binary> [--allow-downgrade]`; `history list|search --from <time>`. */
  from?: string;
  allowDowngrade?: true;
  /** `history list|search|get|tool`: what to read (issue #3461); `--to` is `until`, `message send` has a `to` of its own. */
  cwd?: string;
  projectKey?: string;
  until?: string;
  origin?: "flightdeck" | "external";
  /** `vault decisions|rules|rules preview <secret>`, `vault decisions|report --days`, `vault report --csv`. */
  secretId?: string;
  days?: number;
  csv?: true;
  /** `vault rules preview`: the use to ask about. `--action` is `useAction`, `--tag` repeats, `--at` is milliseconds. */
  requester?: VaultRequester;
  purpose?: "ssh" | "action" | "run_with_secret";
  useAction?: string;
  tags?: string[];
  risk?: "low" | "medium" | "high";
  approval?: "always" | "never" | "first-per-session";
  at?: number;
  hideAutomated?: true;
  cursor?: string;
  tail?: true;
  claudeSessionId?: string;
  uuid?: string;
  index?: number;
  /** `claude [args]`: everything after `claude` belongs to the real claude. */
  claudeArgs?: string[];
  /** `askpass <prompt...>`: what ssh is asking for. */
  askpassPrompt?: string;
}
