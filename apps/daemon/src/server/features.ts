/**
 * Issue #1288: the features the daemon announces in `host.info`, read from its options. A leaf of
 * its own, so the server context reads them without importing the `host.info` handler.
 */
import {
  FEATURE_HOLD_PROOF,
  FEATURE_RESUME_OFFER,
  FEATURE_SERVICE_INSTALL,
} from "@flightdeck/protocol";
import type { ServerOptions } from "../server-options.ts";

/** The names a feature adds when the daemon has it. */
export const when = (has: unknown, ...names: string[]): string[] => (has ? names : []);

/** What this daemon has, as `host.info` announces it; the app hides what is missing. */
export function featuresOf(opts: ServerOptions): string[] {
  return [
    // A high-risk permission allow needs `held: true` (issue #251).
    FEATURE_HOLD_PROOF,
    // The sessions a restart interrupted can be listed (`session.interrupted`, issue #150).
    FEATURE_RESUME_OFFER,
    // The folder picker of the app browses the host's folders with `fs.dirs`.
    ...when(opts.roots?.picker, "fs.dirs", "fs.files"),
    // A live managed session takes a new permission mode and model, and announces its slash commands.
    ...when(opts.sessionSettings?.commands, "session.settings", "session.effort"),
    // A message may carry images (`session.send` with `images`).
    "session.images",
    ...when(opts.hostChecks?.doctor, "doctor.run"),
    ...when(opts.serviceInstall, FEATURE_SERVICE_INSTALL),
    ...when(opts.keepAwake, "keepAwake"),
    ...when(opts.quota?.pause, "quotaPause"),
    ...when(opts.memoryPause, "memoryPause"),
    ...when(opts.hostPause, "hostPause"),
    // Issue #1478: a running session that says nothing is marked quiet (`quietSince`).
    ...when(opts.sessionSettings?.stall, "stall"),
    ...when(opts.review?.cardReview, "cardReview"),
    // Budgets can be a share of a plan quota window (issue #1248).
    ...when(opts.costs?.budgets?.opts.quota, "quotaBudgets"),
    ...when(opts.hostChecks?.deps, "depsCheck"),
    ...when(opts.projects?.trust, "projectTrust"),
    ...when(opts.harness?.stack, "harnessStack"),
    ...when(opts.alerts, "alerts"),
    // Issue #76: the project's library of documents, with their lifecycle status.
    ...when(opts.knowledge?.list, "knowledge"),
    ...when(opts.knowledge?.feedSwitch, "knowledgeFeed"),
    ...when(opts.knowledge?.status, "knowledgeStatus"),
    ...when(opts.knowledge?.create, "knowledgeCreate"),
    ...when(opts.harness?.preview, "harnessPreview"),
    ...when(opts.harness?.apply, "harnessApply"),
    ...when(opts.harness?.commit, "harnessCommit"),
    ...when(opts.harness?.draft, "harnessDraft"),
    ...when(opts.harness?.templates, "harnessTemplates"),
    ...when(opts.projects?.find, "projects.scan", "projects.clone"),
    ...when(opts.github, "github"),
    ...when(opts.boardsync, "boardsync"),
    ...when(opts.roi, "roi"),
    ...when(opts.activity, "activity"),
    ...when(opts.central, "central"),
    // Issue #1736: an external session says what it waits for (`waiting`), read from its transcript.
    ...when(opts.central, "external.waiting"),
    ...when(opts.board, "workflows"),
    // Issue #1221: a template committed on a new branch and opened as a PR.
    ...when(opts.board, "workflowTemplateAdd"),
    // Phase 24: the run.yaml of a card and its processes.
    ...when(opts.runenv && opts.board, "runenv"),
    ...when(opts.maintenance, "maintenance"),
    ...when(opts.fileLog, "logs"),
    ...when(opts.releases, "releases"),
    ...when(opts.resources, "resources"),
    ...when(opts.worktrees, "worktrees"),
    ...when(opts.quota?.windows, "quota"),
    ...when(opts.account, "account"),
    // Project rules live in the board's projects.
    ...when(opts.board, "rules"),
    // Issue #1568: a project with no PR provider can have it read from its remote.
    ...when(opts.board, "prDetect"),
    ...when(opts.costs?.costs, "costs"),
    ...when(opts.telemetry?.store, "telemetry"),
    ...when(opts.trace, "trace"),
    ...when(opts.summary, "summary"),
    ...when(opts.webhook, "webhook"),
    ...when(opts.bg, "bg"),
    ...when(opts.review?.changes, "review"),
    // Issue #506: the file explorer lists the folders of a session's repository.
    ...when(opts.review?.files, "file.list"),
    // Issue #797: and searches the whole repository, by name or by content.
    ...when(opts.review?.files, "file.search"),
    // Issue #606: a stored tool call opens to its input and result, read from its transcript.
    ...when(opts.history, "history.tool"),
    // Phase 12: the timeline's snapshots, rewind and fork; the agent's MCP, CLAUDE.md, agents and skills.
    ...when(
      opts.checkpoints?.snapshots && opts.checkpoints.rewinder && opts.checkpoints.forker,
      "checkpoints",
    ),
    ...when(opts.agentSetup?.agentcfg && opts.agentSetup.mcp, "agentcfg"),
    ...when(opts.agentSetup?.memory, "memory"),
    ...when(opts.agentSetup?.plugins, "plugins"),
    // Phase 13: the arena is the board's; issues and automations are services of their own.
    ...when(opts.board, "arena"),
    // Phase 31: card dependencies are the board's.
    ...when(opts.board, "deps"),
    // Issue #76: a card pins library documents; the app offers the picker.
    ...when(opts.board, "cardPins"),
    // Issue #1201: a project's card templates; New card offers them.
    ...when(opts.board, "cardTemplates"),
    // Issue #1196: a card merges its open PR (`card.pr.merge`).
    ...when(opts.board, "cardPrMerge"),
    // Issue #1352: the card carries the PR's merge state, review state and open date.
    ...when(opts.board, "prDetails"),
    // Issue #1405: cards whose changes touch the same files carry `mayConflict`.
    ...when(opts.board, "conflictRadar"),
    ...when(opts.issues, "issues"),
    ...when(opts.automations, "automation"),
    ...when(opts.autoApprove, "autoapprove"),
    // Phase 15: the app shows Conexões for hosts that keep ssh destinos.
    ...when(opts.ssh?.targets, "ssh"),
    // Phase 17: the actions that use a vault secret without Claude seeing it.
    ...when(opts.actions, "actions"),
    // Phase 18: saved commands and prompts of the host and its projects.
    ...when(opts.snippets?.library, "snippets"),
    // Phase 20: the engineering personas of the host and its projects.
    ...when(opts.personas?.store, "personas"),
    // Phase 21: messages between sessions, teams and the standard session names.
    ...when(opts.messaging?.messages, "messaging"),
    // Issue #93: `teams.create` and `addMember` take a permission mode per member; issue #2310: an effort.
    ...when(opts.messaging?.teams, "teams", "teams.permissions", "teams.effort"),
    // Phase 22: watching a card's PR and fixing it.
    ...when(opts.prWatch?.watch, "watch"),
    // Issue #77: a card's watch takes more rounds.
    ...when(opts.prWatch?.watch, "watch.extend"),
    ...when(opts.prWatch?.watch, "watch.resolveHeld"),
    ...when(opts.names, "names"),
  ];
}
