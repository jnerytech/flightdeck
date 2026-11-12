/**
 * Issue #1288: what `host.info` says about this host, and the features the daemon announces. It lives
 * beside the handler that answers it, so `server.ts` no longer reads every option to build it.
 */
import {
  ASSISTANT_FEATURE,
  FEATURE_HOLD_PROOF,
  FEATURE_RESUME_OFFER,
  FEATURE_SERVICE_INSTALL,
  type HostRuntime,
} from "@flightdeck/protocol";
import { logPathFor } from "../logs/serve.ts";
import { present } from "../present.ts";
import type { OpenCodeInfo } from "../runtime/opencode-discovery.ts";
import type { ServerOptions } from "../server.ts";
import { isVaultTransport } from "../vault/vault.ts";
import { DAEMON_VERSION } from "../version.ts";
import type { ServerContext } from "./context.ts";

/** What `host.info` says about OpenCode: no executable fingerprint, no finding paths. */
function hostRuntime(info: OpenCodeInfo): HostRuntime {
  return {
    kind: "opencode",
    available: info.available,
    ...(info.path ? { path: info.path } : {}),
    ...(info.version ? { version: info.version } : {}),
    ...(info.verified !== undefined ? { verified: info.verified } : {}),
    ...(info.reason ? { reason: info.reason } : {}),
  };
}

/** The names a feature adds when the daemon has it. */
const when = (has: unknown, ...names: string[]): string[] => (has ? names : []);

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
    ...when(opts.snapshots && opts.rewinder && opts.forker, "checkpoints"),
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
    // Issue #93: `teams.create` and `addMember` take a permission mode per member.
    ...when(opts.messaging?.teams, "teams", "teams.permissions"),
    // Phase 22: watching a card's PR and fixing it.
    ...when(opts.prWatch?.watch, "watch"),
    // Issue #77: a card's watch takes more rounds.
    ...when(opts.prWatch?.watch, "watch.extend"),
    ...when(opts.prWatch?.watch, "watch.resolveHeld"),
    ...when(opts.names, "names"),
  ];
}

/** The answer to `host.info`: the host's identity, what it runs and what it is set to. */
export async function hostInfo(server: ServerContext, origin: string) {
  const { opts } = server;
  // `update` once the daemon has checked its manifest.
  const update = opts.updates?.check?.status();
  return {
    hostName: opts.hostName,
    os: process.platform,
    arch: process.arch,
    daemonVersion: DAEMON_VERSION,
    claudeVersion: (await opts.claude?.version()) ?? null,
    claudePath: opts.claude?.path ?? null,
    uptimeSec: Math.floor((Date.now() - server.startedAt) / 1000),
    activeSessions: server.manager.activeSessionCount(),
    apiKeySanitized: server.manager.apiKeySanitized(),
    // Issue #1361: whether this connection is near (loopback or Tailscale); only a near one may
    // change what runs unattended, so the app shows those settings read-only otherwise.
    near: isVaultTransport(origin),
    // The terminal can be turned on and off while the daemon runs: asked each time.
    features: [
      ...(opts.features ?? server.features),
      ...when(opts.terminals?.enabled, "terminal", "terminal.session"),
      // Issue #506: a path a terminal printed opens in the Files viewer, from its folder.
      ...when(opts.terminals?.enabled && opts.review?.files, "file.terminal"),
      ...when(opts.ui, "ui.mode"),
      ...when(opts.agentSetup?.templates, "templates"),
      ...when(opts.agentSetup?.tasks, "tasks"),
      ...when(opts.opencode?.info().available, "opencode"),
      ...when(opts.assistant, ASSISTANT_FEATURE),
      ...when(opts.teleport?.packages || opts.teleport?.inbox, "teleport"),
      ...when(opts.updates?.auto, "autoUpdate"),
    ],
    ...present({
      terminal: opts.terminals?.settings(),
      ui: opts.ui && { ...opts.ui },
      allowBypassPermissions: opts.sessionSettings?.bypass?.allowed(),
      sleepAfterMinutes: opts.sessionSettings?.sleep?.minutes(),
      keepAwake: opts.keepAwake?.status(),
      pause: opts.hostPause?.status(),
      runtimes: opts.opencode && [hostRuntime(opts.opencode.info())],
      update,
      autoUpdate: opts.updates?.auto?.status(),
    }),
    ...(opts.fileLog ? logPathFor(opts.fileLog, origin) : {}),
    ...opts.terminal,
  };
}
