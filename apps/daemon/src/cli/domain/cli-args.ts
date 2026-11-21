/** The words of the `flightdeckd` command line, parsed (issue #1593): what `parseArgs` returns. */
import type {
  AgentCfgItem,
  BoardColumn,
  MessageStatus,
  VaultRequester,
} from "@flightdeck/protocol";
import type { RuntimeKind } from "../../config.ts";
import type { ProjectFields } from "../../projects/index.ts";
import type { SessionStartOptions } from "../../sessions/index.ts";
import type { SshSaveFields } from "../../ssh/index.ts";

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
    | "plugins"
    | "project"
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
    | "knowledge"
    | "statusline"
    | "action"
    | "snippet"
    | "message"
    | "card"
    | "team"
    | "persona"
    | "board"
    | "quota"
    | "usage"
    | "budget"
    | "costs"
    | "roi"
    | "host"
    | "sessions"
    | "session"
    | "ssh"
    | "terminal"
    | "agentcfg"
    | "watch"
    | "boardsync"
    | "review"
    | "memory"
    | "runenv"
    | "changes"
    | "snapshots"
    | "rewind"
    | "trace"
    | "bg"
    | "file"
    | "automation"
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
    | "index"
    | "feed"
    | "enable"
    | "disable"
    | "enroll"
    | "reset"
    | "list"
    | "run"
    | "write"
    | "get"
    | "send"
    | "idle"
    | "read"
    | "team"
    | "show"
    | "new"
    | "move"
    | "update"
    | "config"
    | "runs"
    | "complete"
    | "delete"
    | "discard"
    | "settings"
    | "open"
    | "open-session"
    | "watch"
    | "subagents"
    | "save"
    | "remove"
    | "resume"
    | "publish-agent"
    | "trust"
    | "toggle"
    | "diff"
    | "spec"
    | "review"
    | "budget"
    | "suggest"
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
    | "close"
    | "remove-member"
    | "history"
    | "pause-at"
    | "set"
    | "set-quota"
    | "summary"
    | "session"
    | "card"
    | "export"
    | "reprice"
    | "dismiss-unblocked"
    | "search"
    | "tool"
    | "decisions"
    | "report"
    | "rules"
    | "rules-set"
    | "preview"
    | "apply"
    | "undo"
    | "interrupted"
    | "import-preview"
    | "import-history"
    | "favorite"
    | "use"
    | "render"
    | "parse"
    | "trace"
    | "describe"
    | "by-url"
    | "boards"
    | "log"
    | "link"
    | "sessions"
    | "unlink"
    | "set-map"
    | "set-push"
    | "sync-now"
    | "extend"
    | "resolve-held"
    | "follow"
    | "revert"
    | "undo-revert"
    | "commit"
    | "pr"
    | "hostkey-check"
    | "hostkey-confirm"
    | "hostkey-forget"
    | "import-apply"
    | "add"
    | "edit"
    | "test"
    | "files"
    | "dirs"
    | "interrupt"
    | "sleep"
    | "set-model"
    | "set-effort"
    | "meta-set"
    | "create"
    | "set-mode"
    | "fork"
    | "apply-persona"
    | "clear-persona"
    | "detail"
    | "preview-update"
    | "pin"
    | "unpin"
    | "marketplace-add"
    | "marketplace-remove"
    | "marketplace-update"
    // `project` (#3515)
    | "trust-state"
    | "stack"
    | "trust-inspect"
    | "harness-preview"
    | "detect-provider"
    | "harness-draft"
    | "harness-export"
    | "harness-apply"
    | "harness-commit";
  /** `message send <to> <text>`. */
  to?: string;
  text?: string;
  /** `message idle|read <session>`, with `--last N` for read; `requests --session`. */
  session?: string;
  /** `--host <name>`: ask the paired host of that name instead of this machine's daemon (#3429). */
  host?: string;
  /** `send <session> <text>`: the session that gets the text, its name or its id. */
  sendTo?: string;
  /** `ssh hostkey check|test <target>`: the destination, its name or its id. */
  sshTarget?: string;
  /** `ssh hostkey confirm <target> --fingerprint <SHA256:...>`: the fingerprint the person read and accepts. */
  sshFingerprint?: string;
  /** `ssh import apply --alias <name>...`: the `~/.ssh/config` names to turn into destinations. */
  sshAliases?: string[];
  /** `terminal open --cwd <folder>`, `open-session --session <name|id>` and `settings --enable --confirm`, kept apart from the flags other commands also read. */
  terminalCwd?: string;
  terminalSession?: string;
  terminalPersona?: string;
  terminalConfirm?: true;
  /** `agentcfg list|read|write <project>` (#3617): the project word, `--kind`, `--path`, `--file`, `--expected-hash` and `--new`; `--origin` and `--confirm` are the shared fields. */
  agentcfgWords?: string[];
  agentcfgKind?: AgentCfgItem["kind"];
  /** `--path`, of `agentcfg read|write` and `review add`. */
  pathFlag?: string;
  agentcfgFile?: string;
  agentcfgHash?: string;
  agentcfgNew?: true;
  /** `mcp list <project>`, `mcp status <session>` or `mcp test <project> <server>` (#3616): the operands; a bare `mcp` is the stdio server and has none. */
  mcpWords?: string[];
  /** `knowledge list|index|feed <project>` (#3623): a project's name or id, or its folder. */
  knowledgeProject?: string;
  /** `mcp toggle --enable|--disable` (#3616): the direction, moved off the terminal flags it shares. */
  mcpEnabled?: boolean;
  /** `terminal close <terminal>`: the terminal to close, its id. */
  terminalId?: string;
  /** `terminal open|open-session --cols <n> --rows <n>`: the size the terminal opens at. */
  terminalCols?: number;
  terminalRows?: number;
  /** `terminal open ... -- <program> <argument>...`: what runs in the terminal, never through a shell. */
  terminalArgv?: string[];
  /** `terminal open --claude [--resume <id>] [--persona <id>]`: Claude Code in the folder, not a shell. */
  terminalClaude?: true;
  terminalResume?: string;
  /** `terminal close --kill`: end the process, not only detach. */
  terminalKill?: true;
  /** `terminal settings --enable|--disable`: whether the host's terminals are on. */
  terminalEnable?: true;
  terminalDisable?: true;
  /** `ssh add|edit`: the flags that set a destination. */
  sshSave?: SshSaveFields;
  /** `watch get|trace|describe|set|extend|resolve-held|follow <card>`, `watch by-url <link>` or `watch settings <project>`: the operand. */
  watchTarget?: string;
  /** `snapshots list|files`, `rewind preview` and `trace get|export`: the Claude session id. */
  checkpointSession?: string;
  /** `snapshots files <id> <n>` and `rewind preview <id> <turn>`: the turn number. */
  checkpointTurn?: number;
  /** `trace export --include-content`: the prompts and results too, with secrets replaced. */
  includeContent?: true;
  /** `memory list|read|budget|suggest <project>`: the project, by name or id. */
  memoryProject?: string;
  /** `memory read <project> <name>`: the file, a plain name inside the memory folder. */
  memoryName?: string;
  /** `changes get|watch <target>` or `changes sessions <file>`: the operand. */
  changesOperand?: string;
  /** `changes revert|undo-revert <target> <file>`: the file. */
  changesPath?: string;
  /** `changes commit`: each `--digest <path>=<digest>` the person saw, in the order typed. */
  changesDigests?: Array<[string, string]>;
  changesBranch?: string;
  changesRemote?: string;
  /** `changes commit --message`, `changes pr --title` and `--body`, `--confirm` of the writes. */
  changesMessage?: string;
  changesTitle?: string;
  changesBody?: string;
  changesConfirm?: true;
  /** `file list|read|search <target>`: `session:<id>`, `card:<id>`, `terminal:<id>` or `project:<id>`. */
  fileTarget?: string;
  /** `file read <target> <path>`, `file dirs [<path>]` and `file files <path>`: the path. */
  filePath?: string;
  /** `file list --dir`: the folder of the repository, "" for its root. */
  fileDir?: string;
  /** `file search --query`, `--mode` and `--limit`. */
  fileQuery?: string;
  fileMode?: "name" | "content";
  fileLimit?: number;
  /** `file dirs|files --hidden`. */
  fileHidden?: true;
  /** `file write --file`: the new text's file, or `-` for standard input. */
  fileText?: string;
  /** `file write --hash`: the sha256 `file read` printed, the version the write replaces. */
  fileHash?: string;
  /** `file write --confirm`. */
  fileConfirm?: true;
  /** `review list|add|send <target>`: `session:<id>`, `card:<id>`, `terminal:<id>` or `project:<id>`. */
  reviewTarget?: string;
  /** `review update|remove <comment>`: the comment's id. */
  reviewComment?: string;
  /** `review add --side new|old`: the side of the diff; `new` when absent. */
  reviewSide?: "new" | "old";
  /** `review add --lines <start>[-<end>]`: the lines the comment covers. */
  reviewLines?: { start: number; end: number };
  /** `runenv config <project>` or `runenv get <card>`: the operand. */
  runenvTarget?: string;
  /** `automation list|save <project>` or `automation runs|enable|disable|remove <automation>`: the operand. */
  automationTarget?: string;
  /** `automation save --automation <id>`: the automation to change; `--name` is `personaName`. */
  automationId?: string;
  /** `automation save --max-runs <n>`. */
  maxRuns?: number;
  /** `automation save --external-authors on|off`. */
  externalAuthors?: boolean;
  /** `action save --secret-ids a,b`: the ids of the secrets the vault has, so a reference to another is refused. */
  secretIds?: string[];
  /** `automation save --definition-file <file>`: the JSON of the trigger and the action. */
  definitionFile?: string;
  /** `boardsync status <project>` or `boardsync log <card>`: the operand. */
  boardsyncTarget?: string;
  /** `boardsync link <project> <board>`: the board's id. */
  boardsyncBoard?: string;
  /** `boardsync link|set-map --map <status>=<column>`, each pair once. */
  boardsyncMap?: Record<string, BoardColumn>;
  /** `boardsync set-push --on|--off`. */
  boardsyncPush?: boolean;
  /** `watch resolve-held <card> <round>`: the round. */
  watchRound?: string;
  /** `watch set|settings`: `--enable` is true, `--disable` false and `--default` (set only) null. */
  watchSwitch?: boolean | null;
  /** `watch extend --rounds <n>`: the rounds the card is allowed on top. */
  watchRounds?: number;
  /** `watch resolve-held --push|--drop`. */
  watchResolution?: "push" | "drop";
  /** `watch settings`: the fields the flags set, as the protocol's patch. */
  watchPatch?: Record<string, unknown>;
  /** The flags of the watch verbs that were typed, to refuse one on a verb that does not take it. */
  watchFlags?: string[];
  /** `session summary|files <session>`: the session to read, its name or its id. */
  sessionRef?: string;
  /** `session set-model|set-effort <session> <value>`: the model or the effort, or `default`. */
  sessionValue?: string;
  /** `session meta set <session> name=... pinned=... archived=...`: the fields to change. */
  sessionMeta?: { name?: string | null; pinned?: boolean; archived?: boolean };
  /** `session create|fork|apply-persona|clear-persona`: the options of the verb. */
  sessionStart?: SessionStartOptions;
  /** `approve|deny <request>`: the id of the permission request. */
  requestId?: string;
  /** `approve|deny --message`: what the answer tells Claude. */
  answerMessage?: string;
  /** `approve --hold`: accepted for older scripts; it sends nothing, a high-risk allow is made in the app (#3439). */
  hold?: boolean;
  last?: number;
  /** `message team <team>`. */
  team?: string;
  /** `message history` (#3622): `--team`, `--with-host` and `--status`; `--session`, `--days` and `--limit` are the shared fields. */
  messageTeam?: string;
  withHost?: string;
  messageStatus?: MessageStatus;
  policyFile?: string;
  unpause?: string[];
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
  /** `quota history <window> [--hours n]`, `quota pause-at <0-1|off>` (null is off), `usage [--days n]` (#3460; `days` is also the `vault` window below). */
  quotaWindow?: string;
  quotaPauseAt?: number | null;
  hours?: number;
  /** `budget set|set-quota` and `budget remove <id>` (#3460); `--scope` and `--project` are the shared flags. */
  budgetId?: string;
  budgetPeriod?: "day" | "month";
  budgetWindow?: "five_hour" | "seven_day";
  limitUsd?: number;
  limitPct?: number;
  budgetAction?: "notify" | "queue";
  /** `costs session|card|run <id>`: the Claude session, card or run id. */
  costsId?: string;
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
  /** `plugins install|update --confirm-hash <hash> [--accept-command <sha256>]`, `--plugin-scope user|project|local`, and the source or name `marketplace-add|remove|update` takes (#3516). */
  confirmHash?: string;
  acceptCommand?: string;
  pluginScope?: "user" | "project" | "local";
  marketplace?: string;
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
  /** `action run <name>` or `action runs <name>`. */
  actionName?: string;
  /** `action list --plain`: lines for a person, where `--json` is the stable value. */
  plain?: boolean;
  /** `snippet get <name>` (phase 18). */
  snippetName?: string;
  /** `snippet ... --project-path <path>`: the project whose snippets count too. */
  projectPath?: string;
  /** `snippet list --query <text>`. */
  query?: string;
  /** `snippet parse <file>`: the file to read, or `-` for stdin. */
  snippetFile?: string;
  /** `snippet render --value name=value`, repeatable. */
  snippetValues?: Record<string, string>;
  /** `snippet import-history --reveal`: show the commands the secret scan hid. */
  snippetReveal?: boolean;
  /** `snippet save --run <command>`: a command snippet. */
  snippetRun?: string;
  /** `snippet save --text <prompt>`: a prompt snippet. */
  snippetText?: string;
  /** `snippet import-history --select <id,id,...>`: the candidates to make snippets. */
  snippetSelect?: string[];
  /** `snippet use --terminal <id>`: the terminal the command is typed into. */
  snippetTerminal?: string;
  /** `snippet use --enter`: also press Enter, which runs the command. */
  snippetEnter?: boolean;
  /** `snippet favorite --off`: clear the mark. */
  snippetOff?: boolean;
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
  origin?: "flightdeck" | "external" | "project" | "user";
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
  /** `plugins detail|preview|preview-update <plugin>`, `plugins preview --dir <folder>` (#3516). */
  plugin?: string;
  pluginDir?: string;
  /** `project <verb> <folder>...`, `project harness-preview|harness-apply --parts a,b [--template id]` (#3515). */
  projectPaths?: string[];
  projectParts?: string[];
  projectTemplate?: string;
  /** `project harness-apply|harness-commit --digests <file> [--reformat]` (#3515). */
  projectDigests?: string;
  projectReformat?: true;
  /** `project update|detect-provider <name or id>`. */
  projectRef?: string;
  /** Every word of `project <verb>` before the first flag, whichever verb takes it as what. */
  projectWords?: string[];
  /** `project harness-export <folder> <id> <title>`: the id and the title (empty when not typed). */
  projectExport?: { id: string; title: string };
  /** `project add|update`'s fields as flags; `--name` is `personaName`. */
  projectFields?: ProjectFields;
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
