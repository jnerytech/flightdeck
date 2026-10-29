import type {
  CommandPayload,
  EventEnvelope,
  McpLiveStatus,
  PendingPermission,
  PermissionMode,
  PermissionUpdate,
  SessionEvent,
  SessionEventOf,
  SessionStatus,
  SessionSummary,
} from "@flightdeck/protocol";
import { summarizeInput } from "../central/external-permissions.ts";
import { userHome } from "../config.ts";
import { API_KEY_VARS, buildChildEnv } from "../env.ts";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import type { AutoApproveRequest, AutoApprover } from "../permissions/auto-approve.ts";
import { PermissionBroker } from "../permissions/permission-broker.ts";
import { parseSuggestions } from "../permissions/permission-updates.ts";
import { type Risk, RiskClassifier } from "../permissions/risk.ts";
import type {
  AgentRun,
  AgentRuntime,
  QuotaReading,
  RewindFilesResult,
  RuntimeEvent,
} from "../runtime/types.ts";
import type { EventStore } from "../store/event-store.ts";
import { ulid } from "../ulid.ts";

export const RESTART_REASON = "daemon reiniciado";

export interface SessionManagerOptions {
  store: EventStore;
  runtime: AgentRuntime;
  allowedRoots: readonly string[];
  defaultPermissionMode: PermissionMode;
  allowApiKey: boolean;
  baseEnv: Record<string, string | undefined>;
  /** Plan quota readings of any session go to the host's quota (phase 7). */
  onQuota?: (readings: QuotaReading[]) => void;
  /** Every turn of a managed session, before it is stored (phase 7's usage). */
  onTurn?: (sessionId: string, cwd: string, turn: SessionEventOf<"turn.result">) => void;
  /** Start and end of every turn (phase 12's snapshots); the first start waits for session.init. */
  onTurnEdge?: (edge: TurnEdge) => void;
  /** Phase 13: the risk of each permission request; built-in rules over allowedRoots when absent. */
  risk?: RiskClassifier;
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
  queue: string[];
  closing: boolean;
  /** The first turn's prompt and uuid, until session.init names the Claude session. */
  pendingBefore?: { text: string; uuid: string };
}

const ACTIVE: ReadonlySet<SessionStatus> = new Set(["starting", "running", "awaiting_permission"]);

/**
 * Owns the sessions: starts agent runs, assigns every event a `seq` through the store before
 * fanning it out to subscribers, drives the status machine and the per-session message queue.
 */
export class SessionManager {
  private readonly store: EventStore;
  private readonly broker: PermissionBroker;
  private readonly risk: RiskClassifier;
  private readonly live = new Map<string, LiveSession>();
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly summaryListeners = new Set<EventListener>();
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
      ...(opts.autoApprove
        ? {
            autoDecide: (request: AutoApproveRequest) =>
              (opts.autoApprove as Pick<AutoApprover, "decide">).decide({
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

  list(): SessionSummary[] {
    return this.store.listSessions();
  }

  /** Open permission requests of a session, oldest first, as its summaries list them. */
  pendingPermissions(sessionId: string): PendingPermission[] {
    return this.store.pendingPermissions(sessionId).map((p) => {
      const risk = this.classify(sessionId, p.toolName, p.input);
      return {
        requestId: p.id,
        toolName: p.toolName,
        createdAt: p.createdAt,
        input: summarizeInput(p.input),
        risk: risk.level,
        riskReason: risk.reason,
      };
    });
  }

  /** A request's risk, against the session's cwd. */
  classify(sessionId: string, toolName: string, input: Record<string, unknown>): Risk {
    return this.risk.classify(toolName, input, this.get(sessionId).cwd);
  }

  get(sessionId: string): SessionSummary {
    const session = this.store.getSession(sessionId);
    if (!session) throw new FlightdeckError("not_found", `sessão ${sessionId} não existe`);
    return session;
  }

  create(payload: CommandPayload<"session.create">): { sessionId: string } {
    const cwd = resolveAllowedCwd(payload.cwd, this.opts.allowedRoots);
    const id = ulid();
    const permissionMode = payload.permissionMode ?? this.opts.defaultPermissionMode;
    const name = payload.name ?? null;
    this.store.createSession({
      id,
      name,
      cwd,
      status: "starting",
      permissionMode,
      model: payload.model ?? null,
    });
    this.emit(id, { type: "session.created", cwd, name, permissionMode });
    this.emit(id, { type: "session.status", status: "starting" });
    this.emitSummary(id);
    this.startRun(id);
    this.deliver(id, payload.prompt);
    return { sessionId: id };
  }

  /**
   * Turns a transcript started elsewhere into a managed session: the run starts with `resume`
   * on that Claude session and waits, idle, for the first message.
   */
  createResumed(opts: {
    cwd: string;
    claudeSessionId: string;
    name: string | null;
    permissionMode?: PermissionMode;
  }): { sessionId: string } {
    const cwd = resolveAllowedCwd(opts.cwd, this.opts.allowedRoots);
    const id = ulid();
    const permissionMode = opts.permissionMode ?? this.opts.defaultPermissionMode;
    this.store.createSession({
      id,
      name: opts.name,
      cwd,
      status: "starting",
      permissionMode,
      model: null,
    });
    this.store.updateSession(id, { claudeSessionId: opts.claudeSessionId });
    this.emit(id, { type: "session.created", cwd, name: opts.name, permissionMode });
    this.emit(id, { type: "session.status", status: "starting" });
    this.startRun(id, opts.claudeSessionId);
    this.setStatus(id, "idle", "retomada do histórico");
    return { sessionId: id };
  }

  send(sessionId: string, text: string): { queued: boolean } {
    const session = this.get(sessionId);
    if (session.status === "ended" || session.status === "error") {
      throw new FlightdeckError(
        "invalid_state",
        `sessão está ${session.status}; use session.resume`,
      );
    }
    let live = this.live.get(sessionId);
    if (!live) {
      // Idle session left by a previous daemon process: reattach lazily.
      live = this.startRun(sessionId, session.claudeSessionId ?? undefined);
    }
    if (session.status === "idle") {
      this.deliver(sessionId, text);
      return { queued: false };
    }
    live.queue.push(text);
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

  /** Reopens an `ended` or `error` session with the stored Claude session id. */
  resume(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    if (session.status !== "ended" && session.status !== "error") {
      throw new FlightdeckError("invalid_state", `sessão está ${session.status}; nada a retomar`);
    }
    this.startRun(sessionId, session.claudeSessionId ?? undefined);
    this.setStatus(sessionId, "idle", "retomada");
    return Promise.resolve();
  }

  /** Accepted `updatedPermissions` also go to these listeners (the board's project rules). */
  onPermissionUpdates(listener: (sessionId: string, updates: PermissionUpdate[]) => void): void {
    this.updateListeners.add(listener);
  }

  respondPermission(payload: CommandPayload<"permission.respond">): void {
    const sessionId = this.broker.sessionOf(payload.requestId);
    this.broker.respond(payload);
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
    });
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

  private startRun(sessionId: string, resume?: string): LiveSession {
    const session = this.get(sessionId);
    const run = this.opts.runtime.start({
      cwd: session.cwd,
      permissionMode: session.permissionMode,
      env: buildChildEnv(this.opts.baseEnv, this.opts.allowApiKey),
      canUseTool: (toolName, input, ctx) =>
        this.broker.request(
          sessionId,
          toolName,
          input,
          ctx.signal,
          parseSuggestions(ctx.suggestions),
        ),
      ...(resume ? { resume } : {}),
      ...(session.model ? { model: session.model } : {}),
    });
    const live: LiveSession = { run, queue: [], closing: false };
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
        this.fail(sessionId, live, "runtime_exit", "o runtime encerrou inesperadamente");
    } catch (error) {
      if (!live.closing) {
        this.fail(
          sessionId,
          live,
          "runtime",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
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
        this.opts.onTurn?.(sessionId, this.get(sessionId).cwd, event);
        this.turnEdge(sessionId, "after");
        this.emit(sessionId, event);
        const next = live.queue.shift();
        if (next !== undefined) this.deliver(sessionId, next);
        else this.setStatus(sessionId, "idle");
        return;
      }
      default:
        this.emit(sessionId, event);
    }
  }

  private deliver(sessionId: string, text: string): void {
    const live = this.live.get(sessionId);
    if (!live) throw new FlightdeckError("invalid_state", "sessão sem runtime ativo");
    const status = this.get(sessionId).status;
    if (status !== "starting") this.setStatus(sessionId, "running");
    this.emit(sessionId, { type: "message.user", text });
    const uuid = crypto.randomUUID();
    if (this.get(sessionId).claudeSessionId) this.turnEdge(sessionId, "before", text, uuid);
    else live.pendingBefore = { text, uuid };
    live.run.send(text, uuid);
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
    const run = this.live.get(sessionId)?.run;
    if (!run?.toggleMcpServer) {
      throw new FlightdeckError(
        "invalid_state",
        "a sessão não está viva para mudar os servidores MCP",
      );
    }
    await run.toggleMcpServer(name, enabled);
  }

  /** Phase 12: the live status of a managed session's MCP servers, as its runtime reports it. */
  async mcpStatus(sessionId: string): Promise<McpLiveStatus[]> {
    const run = this.live.get(sessionId)?.run;
    if (!run?.mcpServerStatus) {
      throw new FlightdeckError(
        "invalid_state",
        "a sessão não está viva para consultar os servidores MCP",
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

  private fail(sessionId: string, live: LiveSession, code: string, message: string): void {
    if (this.live.get(sessionId) === live) this.live.delete(sessionId);
    live.closing = true;
    this.broker.cancelSession(sessionId);
    this.emit(sessionId, { type: "session.error", code, message });
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
