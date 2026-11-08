import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CommandPayload,
  EffortLevel,
  EventEnvelope,
  InterruptedSession,
  McpLiveStatus,
  PendingPermission,
  PermissionMode,
  PermissionUpdate,
  SessionEvent,
  SessionEventOf,
  SessionImage,
  SessionPersona,
  SessionRuntime,
  SessionStatus,
  SessionSummary,
  ToolInput,
} from "@flightdeck/protocol";
import { plainInfo } from "@flightdeck/protocol";
import { summarizeInput } from "../central/external-permissions.ts";
import { userHome } from "../config.ts";
import { API_KEY_VARS, buildChildEnv } from "../env.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside, resolveAllowedCwd } from "../paths.ts";
import type { AutoApproveRequest, AutoApprover } from "../permissions/auto-approve.ts";
import { PermissionBroker } from "../permissions/permission-broker.ts";
import { parseSuggestions } from "../permissions/permission-updates.ts";
import { type Risk, RiskClassifier } from "../permissions/risk.ts";
import { type DiskView, writeTarget } from "../permissions/rule-risk.ts";
import { clampPermissionMode, toolAllowed } from "../personas/model.ts";
import type { PreparedPersonas } from "../personas/prepare.ts";
import { type PersonaSnapshot, snapshotOf } from "../personas/snapshot.ts";
import type {
  AgentRun,
  AgentRuntime,
  QuotaReading,
  RewindFilesResult,
  RuntimeEvent,
} from "../runtime/types.ts";
import { type EventStore, personaBadge } from "../store/event-store.ts";
import { ulid } from "../ulid.ts";
import { folderRemoving } from "../worktrees/locks.ts";

/** The reason a restart gives the sessions it interrupts: a code (the app words it), not a sentence. */
export const RESTART_REASON = "daemon_restarted";

/** The request cut at 200 characters, never in the middle of an emoji. */
function cutRequest(text: string): string {
  const cut = text.slice(0, 200);
  const last = cut.codePointAt(cut.length - 1) ?? 0;
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
/** What daemons before the code wrote: rows left by them are still offered. */
const OLD_RESTART_REASON = "daemon reiniciado";
const OFFER_WINDOW_MS = 24 * 3_600_000;

/** Phase 39 (ADR 39-3): permission modes an OpenCode session does not offer. */
const OPENCODE_UNSUPPORTED_MODES: ReadonlySet<PermissionMode> = new Set([
  "acceptEdits",
  "dontAsk",
  "auto",
]);
/** The reason of the `session.status` event a sleeping session logs. */
export const SLEPT_REASON = "slept";

export interface SessionManagerOptions {
  store: EventStore;
  runtime: AgentRuntime;
  /** Phase 39: OpenCode sessions run here; none when the host has no OpenCode. */
  opencode?: AgentRuntime;
  allowedRoots: readonly string[];
  defaultPermissionMode: PermissionMode;
  allowApiKey: boolean;
  /** Whether a session may start in `bypassPermissions` (the host switch); refused when absent. */
  allowBypass?: () => boolean;
  /** Folders being removed (issue #152): no session starts in one. */
  folderLocks?: { isHeld(cwd: string): boolean };
  /** Whether a folder's own configuration may load in a session (issue #196); absent: it always does. */
  trust?: (cwd: string) => { trusted: boolean; configRoot?: string };
  /** Looks at a folder's git boundaries before its run is decided (issue #196); awaited by every async entry. */
  prepareTrust?: (cwd: string) => Promise<void>;
  baseEnv: Record<string, string | undefined>;
  /** Plan quota readings of any session go to the host's quota (phase 7). */
  onQuota?: (readings: QuotaReading[]) => void;
  /** Every turn of a managed session, before it is stored (phase 7's usage). */
  onTurn?: (
    sessionId: string,
    cwd: string,
    turn: SessionEventOf<"turn.result">,
    /** Phase 39: OpenCode turns spend no Claude plan, so the account is not told. */
    runtime: SessionRuntime,
  ) => void;
  /** How many sessions are running or waiting for a permission, after every change of status (keep-awake, #163). */
  onActivity?: (active: number) => void;
  /** Start and end of every turn (phase 12's snapshots); the first start waits for session.init. */
  onTurnEdge?: (edge: TurnEdge) => void;
  /** Phase 13: the risk of each permission request; built-in rules over allowedRoots when absent. */
  risk?: RiskClassifier;
  /** Issue #157: a session the host wants awake (pinned, a card's): it never sleeps. */
  keepAwake?: (session: SessionSummary) => boolean;
  /** Phase 13: the projects' automatic approval. */
  autoApprove?: Pick<AutoApprover, "decide">;
}

export interface TurnEdge {
  sessionId: string;
  claudeSessionId: string;
  cwd: string;
  kind: "before" | "after";
  prompt?: string;
  /** The user message's uuid (before edges), which the SDK rewinds to. */
  turnUuid?: string;
}

export type EventListener = (envelope: EventEnvelope) => void;

interface LiveSession {
  run: AgentRun;
  /** Messages sent while a turn is in progress, delivered one per turn. */
  queue: Array<{ text: string; images?: SessionImage[] }>;
  closing: boolean;
  /** The first turn's prompt and uuid, until session.init names the Claude session. */
  pendingBefore?: { text: string; uuid: string };
  /** Whether the run was given the project's own setup (its folder was trusted when it started). */
  trustedAtStart: boolean;
}

/** What the runtime is given of a session's persona. */
function personaOf(snapshot: PersonaSnapshot) {
  return {
    append: snapshot.append,
    ...(snapshot.effort ? { effort: snapshot.effort } : {}),
    tools: snapshot.tools,
  };
}

const ACTIVE: ReadonlySet<SessionStatus> = new Set(["starting", "running", "awaiting_permission"]);

/**
 * Owns the sessions: starts agent runs, assigns every event a `seq` through the store before
 * fanning it out to subscribers, drives the status machine and the per-session message queue.
 */
/** What an OpenCode session cannot take, by name: a persona, or a permission mode it lacks. */
function unsupportedOnOpenCode(persona: unknown, mode: PermissionMode): string | null {
  if (persona) return "persona";
  return OPENCODE_UNSUPPORTED_MODES.has(mode) ? mode : null;
}

export class SessionManager {
  private readonly store: EventStore;
  private readonly broker: PermissionBroker;
  private readonly risk: RiskClassifier;
  private readonly live = new Map<string, LiveSession>();
  /** Phase 22: sessions Flightdeck opened by itself (see `create`). */
  private readonly unattended = new Set<string>();
  /** Phase 13: the effort of a session started with one (arena variants); not kept across restarts. */
  private readonly efforts = new Map<string, EffortLevel>();
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly summaryListeners = new Set<EventListener>();
  private readonly userListeners = new Set<(sessionId: string, text: string) => void>();
  private readonly updateListeners = new Set<
    (sessionId: string, updates: PermissionUpdate[]) => void
  >();

  constructor(private readonly opts: SessionManagerOptions) {
    this.store = opts.store;
    this.risk =
      opts.risk ?? new RiskClassifier({ allowedRoots: opts.allowedRoots, home: userHome() });
    this.broker = new PermissionBroker(this.store, {
      emit: (sessionId, event) => this.emit(sessionId, event),
      onPendingChange: (sessionId, pending) => this.onPendingChange(sessionId, pending),
      classify: (sessionId, toolName, input) => this.classify(sessionId, toolName, input),
      plain: (sessionId, toolName, input, risk) =>
        this.plainOf(sessionId, toolName, input, risk.level),
      ...(opts.autoApprove
        ? {
            // ADR 39-3: a person answers every question of an OpenCode session.
            autoDecide: (request: AutoApproveRequest) =>
              this.get(request.sessionKey).runtime === "opencode"
                ? Promise.resolve(null)
                : (opts.autoApprove as Pick<AutoApprover, "decide">).decide({
                    ...request,
                    cwd: this.get(request.sessionKey).cwd,
                  }),
          }
        : {}),
    });
    this.recover();
  }

  /** Boot recovery: sessions caught mid-turn become `error`, open permissions `expired`. */
  private recover(): void {
    this.broker.expireStale();
    for (const session of this.store.listSessions()) {
      if (ACTIVE.has(session.status)) this.setStatus(session.id, "error", RESTART_REASON);
    }
  }

  /** Sessions with a turn in progress or waiting for a permission. */
  activeSessionCount(): number {
    return this.store.listSessions().filter((s) => ACTIVE.has(s.status)).length;
  }

  /** False when an API key really reaches the agent (billing would bypass the subscription). */
  apiKeySanitized(): boolean {
    const env = buildChildEnv(this.opts.baseEnv, this.opts.allowApiKey);
    return !Object.keys(env).some((k) =>
      (API_KEY_VARS as readonly string[]).includes(k.toUpperCase()),
    );
  }

  /**
   * The request in plain words (phase 33). Only the host can say whether a file is already there,
   * and whether the request goes to the vault, so the wording is made here and sent with it.
   */
  private async plainOf(
    sessionId: string,
    toolName: string,
    input: ToolInput,
    risk: "low" | "medium" | "high",
  ) {
    const key = "file_path" in input ? "file_path" : "notebook_path";
    const path = input[key];
    let fileExists: boolean | undefined;
    let worded: ToolInput = input;
    if (typeof path === "string") {
      // A relative path is the session's folder's: worded with the folder it really is in.
      const absolute = resolve(this.get(sessionId).cwd, path);
      worded = { ...input, [key]: absolute };
      fileExists = await stat(absolute).then(
        () => true,
        () => false,
      );
    }
    const command = typeof input.command === "string" ? input.command : "";
    return plainInfo({
      toolName,
      input: worded,
      risk,
      ...(fileExists === undefined ? {} : { fileExists }),
      // A request that names the vault is for someone with full access.
      vault: /\bvault\b/i.test(toolName) || /\bflightdeckd?\s+vault\b/i.test(command),
    });
  }

  list(): SessionSummary[] {
    return this.store.listSessions().map((s) => this.withSleep(s));
  }

  /** Idle with no process is asleep: the daemon put it to sleep, or a restart left it so. */
  private withSleep(session: SessionSummary): SessionSummary {
    return { ...session, asleep: session.status === "idle" && !this.live.has(session.id) };
  }

  /** Open permission requests of a session, oldest first, as its summaries list them. */
  pendingPermissions(sessionId: string): PendingPermission[] {
    // A request the host is still wording (phase 33) is not announced yet, so it is not listed yet.
    return this.store
      .pendingPermissions(sessionId)
      .filter((p) => this.broker.isAnnounced(p.id))
      .map((p) => {
        const risk = this.classify(sessionId, p.toolName, p.input);
        const plain = this.broker.plainOf(p.id);
        return {
          requestId: p.id,
          toolName: p.toolName,
          createdAt: p.createdAt,
          input: summarizeInput(p.input),
          risk: risk.level,
          riskReason: risk.reason,
          ...(plain ? { plain } : {}),
        };
      });
  }

  /** A request's risk, against the session's cwd. */
  classify(sessionId: string, toolName: string, input: Record<string, unknown>): Risk {
    return this.risk.classify(toolName, input, this.get(sessionId).cwd);
  }

  get(sessionId: string): SessionSummary {
    const session = this.store.getSession(sessionId);
    if (!session)
      throw new FlightdeckError(
        "not_found",
        `session ${sessionId} does not exist`,
        "session_not_found",
        { id: sessionId },
      );
    return this.withSleep(session);
  }

  /** Phase 39: an OpenCode session is refused before anything is created, so a refusal leaves no session. */
  private async checkOpenCode(
    payload: CommandPayload<"session.create">,
    cwd: string,
  ): Promise<void> {
    const opencode = this.opts.opencode;
    if (!opencode) {
      throw new FlightdeckError(
        "invalid_state",
        "OpenCode is not available on this host",
        "runtime_unavailable",
      );
    }
    const mode = payload.permissionMode ?? this.opts.defaultPermissionMode;
    const unsupported = unsupportedOnOpenCode(payload.persona, mode);
    if (unsupported) {
      throw new FlightdeckError(
        "invalid_state",
        `an OpenCode session does not offer ${unsupported}`,
        "runtime_unsupported",
        { feature: unsupported },
      );
    }
    await opencode.preflight?.(cwd);
  }

  /**
   * `unattended` (phase 22) marks a session Flightdeck opens by itself, with no person in it:
   * it never gets to use `run_with_secret`, which is for a person to approve each time.
   */
  async create(
    payload: CommandPayload<"session.create">,
    extra: { unattended?: boolean; prepared?: PreparedPersonas } = {},
  ): Promise<{ sessionId: string }> {
    const cwd = await resolveAllowedCwd(payload.cwd, this.opts.allowedRoots);
    if (this.opts.folderLocks?.isHeld(cwd)) throw folderRemoving(cwd);
    const runtime = payload.runtime ?? "claude";
    if (runtime === "opencode") await this.checkOpenCode(payload, cwd);
    const id = ulid();
    // Resolved by the caller before anything is created, so a missing, untrusted or invalid
    // persona leaves no session. The manager reads no persona file itself.
    const resolved = extra.prepared?.persona ?? null;
    if (payload.persona && !resolved) {
      throw new FlightdeckError(
        "invalid_state",
        "personas unavailable on this host",
        "personas_off",
      );
    }
    const asked = payload.permissionMode ?? this.opts.defaultPermissionMode;
    if (asked === "bypassPermissions" && !this.bypassAllowed()) {
      throw new FlightdeckError(
        "invalid_permission_update",
        "this host does not allow sessions without permission prompts",
        "bypass_not_allowed",
      );
    }
    // A persona only suggests: it counts when it is less permissive than what was asked for.
    const permissionMode = clampPermissionMode(resolved?.persona.permissionMode ?? null, asked);
    const persona = resolved ? snapshotOf(resolved.persona, resolved.hash) : null;
    const name = payload.name ?? null;
    // The folder's git boundaries are looked at before the session exists: a row that exists can be
    // run by a message that arrives meanwhile, and its trust would be judged without them (#415).
    await this.opts.prepareTrust?.(cwd);
    // A removal may have taken the folder while it was looked at.
    if (this.opts.folderLocks?.isHeld(cwd)) throw folderRemoving(cwd);
    if (extra.unattended) this.unattended.add(id);
    this.store.createSession({
      id,
      name,
      cwd,
      status: "starting",
      permissionMode,
      model: payload.model ?? persona?.model ?? null,
      persona,
      runtime,
      ...(extra.prepared ? { agents: extra.prepared.agents } : {}),
    });
    this.emit(id, {
      type: "session.created",
      cwd,
      name,
      permissionMode,
      ...(persona ? { persona: personaBadge(persona) } : {}),
    });
    this.emit(id, { type: "session.status", status: "starting" });
    this.emitSummary(id);
    if (payload.effort) this.efforts.set(id, payload.effort);
    this.startRun(id);
    if (payload.prompt === undefined) this.setStatus(id, "idle", "no first prompt");
    else this.deliver(id, payload.prompt);
    return { sessionId: id };
  }

  /**
   * Turns a transcript started elsewhere into a managed session: the run starts with `resume`
   * on that Claude session and waits, idle, for the first message.
   */
  async createResumed(opts: {
    cwd: string;
    claudeSessionId: string;
    name: string | null;
    permissionMode?: PermissionMode;
    /** The subagents the session opens with, read by the caller. */
    agents?: PreparedPersonas["agents"];
  }): Promise<{ sessionId: string }> {
    const cwd = await resolveAllowedCwd(opts.cwd, this.opts.allowedRoots);
    if (this.opts.folderLocks?.isHeld(cwd)) throw folderRemoving(cwd);
    const id = ulid();
    const permissionMode = opts.permissionMode ?? this.opts.defaultPermissionMode;
    await this.opts.prepareTrust?.(cwd);
    if (this.opts.folderLocks?.isHeld(cwd)) throw folderRemoving(cwd);
    this.store.createSession({
      id,
      name: opts.name,
      cwd,
      status: "starting",
      permissionMode,
      model: null,
      ...(opts.agents ? { agents: opts.agents } : {}),
    });
    this.store.updateSession(id, { claudeSessionId: opts.claudeSessionId });
    this.emit(id, {
      type: "session.created",
      cwd,
      name: opts.name,
      permissionMode,
      resumedFrom: opts.claudeSessionId,
    });
    this.emit(id, { type: "session.status", status: "starting" });
    this.startRun(id, opts.claudeSessionId);
    this.setStatus(id, "idle", "resumed from history");
    return { sessionId: id };
  }

  send(sessionId: string, text: string, images?: SessionImage[]): { queued: boolean } {
    const session = this.get(sessionId);
    if (session.status === "ended" || session.status === "error") {
      throw new FlightdeckError(
        "invalid_state",
        `session is ${session.status}; use session.resume`,
        "session_ended",
      );
    }
    let live = this.live.get(sessionId);
    // Idle session left by a previous daemon process: reattach lazily.
    live ??= this.startRun(sessionId, session.claudeSessionId ?? undefined);
    if (session.status === "idle") {
      this.deliver(sessionId, text, images);
      return { queued: false };
    }
    live.queue.push({ text, ...(images?.length ? { images } : {}) });
    return { queued: true };
  }

  async interrupt(sessionId: string): Promise<void> {
    this.get(sessionId);
    const live = this.live.get(sessionId);
    if (!live) return;
    live.queue.length = 0;
    this.broker.cancelSession(sessionId);
    await live.run.interrupt();
  }

  async close(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    if (session.status === "ended") return;
    const live = this.live.get(sessionId);
    if (live) {
      live.closing = true;
      live.queue.length = 0;
      this.broker.cancelSession(sessionId);
      this.live.delete(sessionId);
      await live.run.close();
    }
    this.setStatus(sessionId, "ended");
  }

  /**
   * Ends an idle session's process and keeps the session: it stays `idle`, with no process, which
   * is also how a session a restart left looks, and the next message starts the process again from
   * its Claude session id (`send` already does that). It sleeps only when nothing is going on:
   * no turn, no open request, no queued message, nobody subscribed (unless `manual`: the person
   * asked) and nothing the host wants awake (`keepAwake`: pinned, or a card's). The event log says why.
   */
  async sleep(
    sessionId: string,
    options: { manual?: boolean } = {},
  ): Promise<"slept" | "already" | "not_idle" | "queued" | "subscribed" | "kept_awake"> {
    const session = this.get(sessionId);
    if (session.status !== "idle") return "not_idle";
    const live = this.live.get(sessionId);
    if (!live) return "already";
    if (live.queue.length > 0) return "queued";
    if (this.opts.keepAwake?.(session)) return "kept_awake";
    if (!options.manual && (this.listeners.get(sessionId)?.size ?? 0) > 0) return "subscribed";
    live.closing = true;
    this.live.delete(sessionId);
    await live.run.close();
    this.setStatus(sessionId, "idle", SLEPT_REASON);
    return "slept";
  }

  /** The sessions a daemon restart interrupted in the last 24 hours and nobody resumed since. */
  interrupted(options: { now?: number; withinMs?: number } = {}): InterruptedSession[] {
    const now = options.now ?? Date.now();
    const within = options.withinMs ?? OFFER_WINDOW_MS;
    const found: InterruptedSession[] = [];
    // In the order they were started (a team's coordinator comes before its workers); only what is
    // still `error`: a resumed or ended session left the offer.
    for (const session of this.store.listSessionsByStatus("error")) {
      // Without a Claude session id there is nothing to resume.
      if (!session.claudeSessionId) continue;
      const events = this.store.eventsSince(session.id);
      const marked = [...events]
        .reverse()
        .find((e) => e.event.type === "session.status" && e.event.status === "error");
      const reason = marked?.event.type === "session.status" ? marked.event.reason : undefined;
      if (!marked || (reason !== RESTART_REASON && reason !== OLD_RESTART_REASON)) continue;
      const interruptedAt = Date.parse(marked.ts);
      if (!Number.isFinite(interruptedAt) || now - interruptedAt > within) continue;
      const asked = [...events].reverse().find((e) => e.event.type === "message.user");
      found.push({
        sessionId: session.id,
        name: session.name,
        cwd: session.cwd,
        persona: session.persona?.name ?? null,
        interruptedAt: marked.ts,
        ranMs: Math.max(0, interruptedAt - Date.parse(session.createdAt)),
        lastRequest: asked?.event.type === "message.user" ? cutRequest(asked.event.text) : null,
      });
    }
    return found;
  }

  /** Reopens an `ended` or `error` session with the stored Claude session id. */
  resume(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    // The refusal is thrown at once (callers and tests read it without awaiting), the rest waits
    // for the folder's git boundaries.
    if (session.status !== "ended" && session.status !== "error") {
      throw new FlightdeckError(
        "invalid_state",
        `session is ${session.status}; nothing to resume`,
        "session_not_ended",
      );
    }
    // Not in a folder a removal is working on.
    if (this.opts.folderLocks?.isHeld(session.cwd)) throw folderRemoving(session.cwd);
    return this.reattach(sessionId, session);
  }

  private async reattach(sessionId: string, session: SessionSummary): Promise<void> {
    await this.opts.prepareTrust?.(session.cwd);
    // Phase 39: an OpenCode session is checked again before it reopens; a refusal leaves it ended.
    if (session.runtime === "opencode") await this.runtimeOf(session).preflight?.(session.cwd);
    this.startRun(sessionId, session.claudeSessionId ?? undefined);
    this.setStatus(sessionId, "idle", "resumed");
  }

  /** Accepted `updatedPermissions` also go to these listeners (the board's project rules). */
  onPermissionUpdates(listener: (sessionId: string, updates: PermissionUpdate[]) => void): void {
    this.updateListeners.add(listener);
  }

  /** The folder of the session a request is open in, and the file it writes; cwd "" when not open. */
  permissionPlace(requestId: string): { cwd: string; target?: string } {
    const sessionId = this.broker.sessionOf(requestId);
    const cwd = sessionId ? (this.store.getSession(sessionId)?.cwd ?? "") : "";
    const asked = this.broker.askedOf(requestId);
    const target = asked ? writeTarget(asked.toolName, asked.input) : undefined;
    return target === undefined ? { cwd } : { cwd, target };
  }

  respondPermission(payload: CommandPayload<"permission.respond">, disk?: DiskView): void {
    const sessionId = this.broker.sessionOf(payload.requestId);
    this.broker.respond(payload, disk);
    const updates = payload.decision === "allow" ? (payload.updatedPermissions ?? []) : [];
    if (updates.length === 0) return;
    for (const listener of this.updateListeners) listener(sessionId, updates);
  }

  /**
   * Returns the events after `sinceSeq` and registers `listener` for live ones. Both happen in
   * the same synchronous step, so nothing can be missed or delivered twice in between.
   */
  subscribe(
    sessionId: string,
    sinceSeq: number,
    listener: EventListener,
  ): { session: SessionSummary; replay: EventEnvelope[]; unsubscribe: () => void } {
    const session = this.get(sessionId);
    const replay = this.store.eventsSince(sessionId, sinceSeq);
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return {
      session,
      replay,
      unsubscribe: () => {
        this.listeners.get(sessionId)?.delete(listener);
      },
    };
  }

  /**
   * Streams a `session.summary` for every session on each status or pending-permission change.
   * Returns the current summary of every session, registered in the same synchronous step.
   */
  watchSummaries(listener: EventListener): { snapshot: EventEnvelope[]; unwatch: () => void } {
    const snapshot = this.store.listSessions().map((s) => this.summaryEnvelope(s.id));
    this.summaryListeners.add(listener);
    return { snapshot, unwatch: () => this.summaryListeners.delete(listener) };
  }

  /** Whether a live run was given the project's setup and its folder is no longer trusted (issue #463). */
  private stale(sessionId: string, live: LiveSession): boolean {
    return live.trustedAtStart && this.opts.trust?.(this.get(sessionId).cwd).trusted === false;
  }

  /** How many live sessions in `folder` run with a setup its trust no longer covers (issue #463). */
  staleSessions(folder: string): number {
    const here = resolve(folder);
    return [...this.live].filter(
      ([id, live]) => isInside(here, resolve(this.get(id).cwd)) && this.stale(id, live),
    ).length;
  }

  /**
   * Tells the watchers that the trust of a folder changed: every live session that loaded a setup
   * says again whether it is stale now (a revoked trust marks it, a trust given again clears it).
   */
  trustChanged(): void {
    for (const [id, live] of this.live) if (live.trustedAtStart) this.emitSummary(id);
  }

  /** Phase 21: told when a user message reaches a session (a queued one is delivered then). */
  onUserMessage(listener: (sessionId: string, text: string) => void): () => void {
    this.userListeners.add(listener);
    return () => this.userListeners.delete(listener);
  }

  /** The stored events of a session after a sequence number (its transcript, for reading it). */
  eventsSince(sessionId: string, sinceSeq = 0): EventEnvelope[] {
    this.get(sessionId);
    return this.store.eventsSince(sessionId, sinceSeq);
  }

  /** Ephemeral: the store does not persist it and stamps it with the last persisted seq. */
  private summaryEnvelope(sessionId: string): EventEnvelope {
    const session = this.get(sessionId);
    return this.store.appendEvent(sessionId, {
      type: "session.summary",
      sessionId,
      name: session.name,
      cwd: session.cwd,
      status: session.status,
      pendingPermissions: this.pendingPermissions(sessionId),
      updatedAt: session.updatedAt,
      ...(session.runtime === "opencode" ? { runtime: "opencode" as const } : {}),
      ...(this.isStale(sessionId) ? { trustStale: true as const } : {}),
    });
  }

  private isStale(sessionId: string): boolean {
    const live = this.live.get(sessionId);
    return live !== undefined && this.stale(sessionId, live);
  }

  private emitSummary(sessionId: string): void {
    if (this.summaryListeners.size === 0) return;
    const envelope = this.summaryEnvelope(sessionId);
    for (const listener of this.summaryListeners) {
      try {
        listener(envelope);
      } catch {
        // A broken watcher must not break the session.
      }
    }
  }

  /** Stops every run without touching statuses; the next boot marks active ones as `error`. */
  async shutdown(): Promise<void> {
    const runs = [...this.live.values()];
    this.live.clear();
    for (const live of runs) live.closing = true;
    await Promise.allSettled(runs.map((live) => live.run.close()));
  }

  // -- internals ------------------------------------------------------------

  /** Phase 39: refuses a Claude-only feature for an OpenCode session. */
  private claudeOnly(sessionId: string, feature: string): void {
    // An unknown session keeps its own refusal (the feature is not live).
    if (this.store.getSession(sessionId)?.runtime !== "opencode") return;
    throw new FlightdeckError(
      "invalid_state",
      `an OpenCode session does not offer ${feature}`,
      "runtime_unsupported",
      { feature },
    );
  }

  /** Phase 39: the runtime a stored session runs on. */
  private runtimeOf(session: SessionSummary): AgentRuntime {
    if (session.runtime !== "opencode") return this.opts.runtime;
    if (!this.opts.opencode) {
      throw new FlightdeckError(
        "invalid_state",
        "OpenCode is not available on this host",
        "runtime_unavailable",
      );
    }
    return this.opts.opencode;
  }

  /** The persona applied to the open session, if any. */
  appliedPersona(sessionId: string): SessionPersona | null {
    this.get(sessionId);
    return this.store.appliedPersona(sessionId);
  }

  /** Records that a persona was applied (or, with `null`, left): the timeline and the badge. */
  markPersona(sessionId: string, badge: SessionPersona | null): void {
    const before = this.store.appliedPersona(sessionId);
    this.store.setAppliedPersona(sessionId, badge);
    const shown = badge ?? before;
    if (shown)
      this.emit(sessionId, { type: badge ? "persona.applied" : "persona.cleared", persona: shown });
    this.emitSummary(sessionId);
  }

  /** The answer to a tool request: denied outright for a free command in an unattended session or a tool the persona does not use, else asked of the person. */
  private canUse(
    sessionId: string,
    persona: ReturnType<EventStore["sessionPersona"]>,
    toolName: string,
    input: Record<string, unknown>,
    ctx: { signal: AbortSignal; suggestions?: unknown },
  ) {
    if (this.unattended.has(sessionId) && /(^|__)run_with_secret$/.test(toolName)) {
      return Promise.resolve({
        behavior: "deny" as const,
        message:
          "run_with_secret is not available in a session Flightdeck started by itself: a person approves each use",
      });
    }
    if (persona && !toolAllowed(persona.tools, toolName)) {
      return Promise.resolve({
        behavior: "deny" as const,
        message: `the persona ${persona.name} does not use the tool ${toolName}`,
      });
    }
    return this.broker.request(
      sessionId,
      toolName,
      input,
      ctx.signal,
      parseSuggestions(ctx.suggestions),
    );
  }

  /** What a run is started with only when the session has it: a resume, a model, an effort, a persona, agents. */
  private optionalRunOptions(
    sessionId: string,
    model: string | null,
    resume: string | undefined,
    persona: ReturnType<EventStore["sessionPersona"]>,
    agents: ReturnType<EventStore["sessionAgents"]>,
  ) {
    const effort = this.efforts.get(sessionId);
    return {
      ...(resume ? { resume } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(persona ? { persona: personaOf(persona) } : {}),
      ...(agents && Object.keys(agents).length > 0 ? { agents } : {}),
    };
  }

  private startRun(sessionId: string, resume?: string): LiveSession {
    const session = this.get(sessionId);
    // The persona the session opened with, as it was then: the prompt it appends is in no transcript.
    const persona = this.store.sessionPersona(sessionId);
    // What the session opened with: a later run reads no persona file.
    const agents = this.store.sessionAgents(sessionId);
    const run = this.runtimeOf(session).start({
      cwd: session.cwd,
      // The mode it last reported (#935): a new run never falls back to the start mode, which
      // stays only the limit of a change.
      permissionMode: this.store.lastMode(sessionId) ?? session.permissionMode,
      allowBypass: this.bypassAllowed(),
      // The session's own id: the Flightdeck MCP it opens knows who is sending (phase 21).
      env: {
        ...buildChildEnv(this.opts.baseEnv, this.opts.allowApiKey),
        FLIGHTDECK_SESSION: sessionId,
      },
      canUseTool: (toolName, input, ctx) => this.canUse(sessionId, persona, toolName, input, ctx),
      ...(this.opts.trust ? { trust: this.opts.trust(session.cwd) } : {}),
      ...this.optionalRunOptions(sessionId, session.model, resume, persona, agents),
    });
    const live: LiveSession = {
      run,
      queue: [],
      closing: false,
      trustedAtStart: this.opts.trust?.(session.cwd).trusted === true,
    };
    this.live.set(sessionId, live);
    void this.consume(sessionId, live);
    return live;
  }

  private async consume(sessionId: string, live: LiveSession): Promise<void> {
    try {
      for await (const event of live.run.events) {
        if (live.closing) return;
        this.handle(sessionId, live, event);
      }
      if (!live.closing)
        this.fail(sessionId, live, "runtime_exit", "the runtime ended unexpectedly");
    } catch (error) {
      if (!live.closing) this.failFrom(sessionId, live, error);
    }
  }

  /** The runtime threw: the session fails, with the error's typed reason when it has one. */
  private failFrom(sessionId: string, live: LiveSession, error: unknown): void {
    // Phase 39: a typed refusal from the runtime keeps its reason for the app to translate.
    const typed =
      error instanceof FlightdeckError && error.reason
        ? { reason: error.reason, ...(error.params ? { params: error.params } : {}) }
        : undefined;
    this.fail(
      sessionId,
      live,
      typed?.reason ?? "runtime",
      error instanceof Error ? error.message : String(error),
      typed,
    );
  }

  private handle(sessionId: string, live: LiveSession, event: RuntimeEvent): void {
    switch (event.type) {
      case "session.init":
        this.store.updateSession(sessionId, {
          claudeSessionId: event.claudeSessionId,
          model: event.model,
        });
        this.emit(sessionId, event);
        if (this.get(sessionId).status === "starting") this.setStatus(sessionId, "running");
        if (live.pendingBefore) {
          this.turnEdge(sessionId, "before", live.pendingBefore.text, live.pendingBefore.uuid);
          live.pendingBefore = undefined;
        }
        return;
      case "quota":
        this.opts.onQuota?.(event.windows);
        return;
      case "turn.result": {
        // Before the event is stored: the usage reads the session's previous total.
        const session = this.get(sessionId);
        this.opts.onTurn?.(sessionId, session.cwd, event, session.runtime ?? "claude");
        this.turnEdge(sessionId, "after");
        this.emit(sessionId, event);
        const next = live.queue.shift();
        if (next !== undefined) this.deliver(sessionId, next.text, next.images);
        else this.setStatus(sessionId, "idle");
        return;
      }
      default:
        this.emit(sessionId, event);
    }
  }

  private deliver(sessionId: string, text: string, images?: SessionImage[]): void {
    const live = this.live.get(sessionId);
    if (!live)
      throw new FlightdeckError(
        "invalid_state",
        "session has no active runtime",
        "session_not_running",
      );
    const status = this.get(sessionId).status;
    if (status !== "starting") this.setStatus(sessionId, "running");
    this.emit(sessionId, {
      type: "message.user",
      text,
      ...(images?.length ? { images: images.length } : {}),
    });
    for (const listener of this.userListeners) {
      try {
        listener(sessionId, text);
      } catch {
        // A broken listener must not break the session.
      }
    }
    const uuid = crypto.randomUUID();
    if (this.get(sessionId).claudeSessionId) this.turnEdge(sessionId, "before", text, uuid);
    else live.pendingBefore = { text, uuid };
    live.run.send(text, uuid, images);
  }

  private turnEdge(
    sessionId: string,
    kind: "before" | "after",
    prompt?: string,
    turnUuid?: string,
  ): void {
    const { claudeSessionId, cwd } = this.get(sessionId);
    if (!claudeSessionId) return;
    this.opts.onTurnEdge?.({
      sessionId,
      claudeSessionId,
      cwd,
      kind,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(turnUuid !== undefined ? { turnUuid } : {}),
    });
  }

  /** Phase 12: turns an MCP server of a live managed session on or off right away. */
  async toggleMcpServer(sessionId: string, name: string, enabled: boolean): Promise<void> {
    this.claudeOnly(sessionId, "mcp");
    const run = this.live.get(sessionId)?.run;
    if (!run?.toggleMcpServer) {
      throw new FlightdeckError(
        "invalid_state",
        "the session is not alive to change its MCP servers",
        "mcp_set_not_live",
      );
    }
    await run.toggleMcpServer(name, enabled);
  }

  private bypassAllowed(): boolean {
    return this.opts.allowBypass?.() === true;
  }

  /** Changes the permission mode of a live managed session, for its next tool requests. */
  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const run = this.live.get(sessionId)?.run;
    if (!run?.setPermissionMode) {
      throw new FlightdeckError(
        "invalid_state",
        "the session is not alive to change its permission mode",
        "mode_set_not_live",
      );
    }
    // Never looser than the mode the session started with (which a persona may have narrowed),
    // unless the person turned the host's switch on: then any mode is theirs to pick.
    if (
      !this.bypassAllowed() &&
      clampPermissionMode(mode, this.get(sessionId).permissionMode) !== mode
    ) {
      throw new FlightdeckError(
        "invalid_permission_update",
        "a session cannot be made more permissive than the mode it started with",
        "mode_looser_than_start",
      );
    }
    await run.setPermissionMode(mode);
    // Told to every app, and kept for a reload (#935); the start mode stays the session's limit.
    // A run that ended during the change reports nothing after its last status.
    if (this.live.get(sessionId)?.run !== run) return;
    this.emit(sessionId, { type: "session.mode", permissionMode: mode });
  }

  /** Changes the model of a live managed session, for its next turn; null is the default. */
  async setModel(sessionId: string, model: string | null): Promise<void> {
    const run = this.live.get(sessionId)?.run;
    if (!run?.setModel) {
      throw new FlightdeckError(
        "invalid_state",
        "the session is not alive to change its model",
        "model_set_not_live",
      );
    }
    await run.setModel(model ?? undefined);
  }

  /** Changes the effort of a live managed session, for its next turn; null is the model's default. */
  async setEffort(sessionId: string, effort: EffortLevel | null): Promise<void> {
    const run = this.live.get(sessionId)?.run;
    if (!run?.setEffort) {
      throw new FlightdeckError(
        "invalid_state",
        "the session is not alive to change its effort",
        "effort_set_not_live",
      );
    }
    await run.setEffort(effort ?? undefined);
    // A session resumed later starts with the effort it was left at (not kept across restarts).
    if (effort) this.efforts.set(sessionId, effort);
    else this.efforts.delete(sessionId);
  }

  /** Phase 12: the live status of a managed session's MCP servers, as its runtime reports it. */
  async mcpStatus(sessionId: string): Promise<McpLiveStatus[]> {
    this.claudeOnly(sessionId, "mcp");
    const run = this.live.get(sessionId)?.run;
    if (!run?.mcpServerStatus) {
      throw new FlightdeckError(
        "invalid_state",
        "the session is not alive to query its MCP servers",
        "mcp_query_not_live",
      );
    }
    return run.mcpServerStatus();
  }

  /** Phase 12: a turn is running (or waiting for a permission) in this Claude session. */
  busy(claudeSessionId: string): boolean {
    return this.list().some((s) => s.claudeSessionId === claudeSessionId && ACTIVE.has(s.status));
  }

  /** Phase 12: the SDK's rewind of a live managed session; null without one. */
  async rewindFiles(
    claudeSessionId: string,
    userMessageId: string,
    dryRun: boolean,
  ): Promise<RewindFilesResult | null> {
    const session = this.list().find((s) => s.claudeSessionId === claudeSessionId);
    const run = session ? this.live.get(session.id)?.run : undefined;
    return run?.rewindFiles ? run.rewindFiles(userMessageId, { dryRun }) : null;
  }

  private fail(
    sessionId: string,
    live: LiveSession,
    code: string,
    message: string,
    typed?: { reason: string; params?: Record<string, string | number> },
  ): void {
    if (this.live.get(sessionId) === live) this.live.delete(sessionId);
    live.closing = true;
    this.broker.cancelSession(sessionId);
    this.emit(sessionId, { type: "session.error", code, message, ...typed });
    this.setStatus(sessionId, "error", message);
    void live.run.close();
  }

  private onPendingChange(sessionId: string, pending: number): void {
    const status = this.get(sessionId).status;
    if (pending > 0 && (status === "running" || status === "starting")) {
      this.setStatus(sessionId, "awaiting_permission");
    } else if (pending === 0 && status === "awaiting_permission") {
      this.setStatus(sessionId, "running");
    } else {
      // Same status, different list of open requests.
      this.emitSummary(sessionId);
    }
  }

  private setStatus(sessionId: string, status: SessionStatus, reason?: string): void {
    const current = this.get(sessionId).status;
    if (current === status && reason === undefined) return;
    this.store.updateSession(sessionId, { status });
    this.emit(sessionId, { type: "session.status", status, ...(reason ? { reason } : {}) });
    this.emitSummary(sessionId);
    this.opts.onActivity?.(this.activeSessionCount());
  }

  private emit(sessionId: string, event: SessionEvent): void {
    const envelope = this.store.appendEvent(sessionId, event);
    for (const listener of this.listeners.get(sessionId) ?? []) {
      try {
        listener(envelope);
      } catch {
        // A broken subscriber must not break the session.
      }
    }
  }
}
