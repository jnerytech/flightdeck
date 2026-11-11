import type { CommandPayload, CommandResults, CommandType, RuleIssue } from "@flightdeck/protocol";
import type { HostConnection } from "./host-connection.ts";

/** Commands sent through `hostCommand`: board (phase 4), hooks, external sessions and meta (phase 5), checkpoints and the agent's config (phase 12). */
export type HostCommandType = Extract<
  CommandType,
  | `terminal.${string}`
  | `runenv.${string}`
  | "roots.add"
  | "history.get"
  | "history.tool"
  | "host.bypass"
  | "logs.tail"
  | "releases.list"
  | "host.sleep"
  | "session.sleep"
  | "host.keepAwake"
  | "host.pause"
  | `project.trust.${string}`
  | `project.harness.${string}`
  | `harness.templates.${string}`
  | "knowledge.list"
  | "knowledge.feed"
  | "knowledge.setFeed"
  | "knowledge.setStatus"
  | "knowledge.create"
  | "host.updates.set"
  | `ssh.${string}`
  | `snippets.${string}`
  | `personas.${string}`
  | `memory.${string}`
  | `plugins.${string}`
  | "session.applyPersona"
  | "session.clearPersona"
  | `askpass.${string}`
  | `project.${string}`
  | `board.${string}`
  | `card.${string}`
  | `hooks.${string}`
  | "service.install"
  | `external.${string}`
  | "session.meta.set"
  | `workflow.${string}`
  | "alert.list"
  | `run.${string}`
  | `gate.${string}`
  | `maintenance.${string}`
  | `resources.${string}`
  | `worktree.${string}`
  | `quota.${string}`
  | `account.${string}`
  | `usage.${string}`
  | `rules.${string}`
  | `costs.${string}`
  | `telemetry.${string}`
  | `trace.${string}`
  | `bg.${string}`
  | `budget.${string}`
  | "deps.check"
  | `changes.${string}`
  | `review.${string}`
  | `file.${string}`
  | "vault.deliver"
  | "vault.deny"
  | "vault.approve"
  | "vault.rules.set"
  | "vault.rules.get"
  | "vault.rules.preview"
  | "messages.watch"
  | "messaging.rules.get"
  | "messaging.rules.set"
  | "messages.list"
  | `teams.${string}`
  | `watch.${string}`
  | "messages.sessions"
  | "messages.send"
  | "messages.relay"
  | "messages.relayed"
  | "messages.directory"
  | "messages.peers"
  | "vault.report"
  | "session.summary"
  | "webhook.send"
  | "vault.decisions"
  | `pr.${string}`
  | "files.sessions"
  | "fs.dirs"
  | "runtime.models"
  | "fs.files"
  | "doctor.run"
  | "projects.scan"
  | "projects.clone"
  | `github.${string}`
  | `boardsync.${string}`
  | "roi.summary"
  | "activity.since"
  | "session.files"
  | `snapshots.${string}`
  | `rewind.${string}`
  | "session.fork"
  | "ui.set"
  | "template.list"
  | "template.start"
  | "task.results"
  | "task.preview"
  | "session.close"
  | "session.resume"
  | `mcp.${string}`
  | `agentcfg.${string}`
  | `issues.${string}`
  | `automation.${string}`
  | `autoapprove.${string}`
  | `actions.${string}`
>;

/** A command's answer kept apart from the error banner: the caller decides what to show. */
export type HostResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      message: string;
      reason?: string;
      params?: Record<string, string | number>;
      items?: readonly RuleIssue[];
    };

/** How `hostCommand` treats a refusal. */
export interface HostCommandOptions {
  /** `false` for a command that opens something: repeated later, unseen, it would leave it behind. */
  retry?: boolean;
  /** The person gave this command: its refusal takes the focus when the step lost it (#1546). */
  focusRefusal?: boolean;
}

/**
 * The narrow part of the app store that every domain's wire file may use to build its slice's
 * port (#1596, docs/decisions/2026-11-11-app-store-wiring.md). `S` is the state the slice reads:
 * the store passes its whole `AppState`, a wire file names only its slice's, so this file imports
 * neither the app state nor a feature and a wire file depending on it creates no cycle. A method
 * joins with the first wire file that uses it; a need of one domain only is a `deps` argument.
 */
export interface AppKernel<S extends object> {
  state(): S;
  update(patch: Partial<S>): void;
  /** Sends a command to a host; a refusal goes to the banner and gives `null`. */
  hostCommand<C extends HostCommandType>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
    options?: HostCommandOptions,
  ): Promise<CommandResults[C] | null>;
  /** Like `hostCommand`, but a refusal comes back with its code instead of going to the banner. */
  hostRequest<C extends HostCommandType>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
  ): Promise<HostResult<CommandResults[C]>>;
  /** A host's open connection, if it has one. */
  connection(hostId: string): HostConnection | undefined;
}
