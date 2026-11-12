import type {
  CommandPayload,
  EffortLevel,
  PermissionMode,
  SessionEvent,
  SessionImage,
  SessionStatus,
  SessionSummary,
} from "@flightdeck/protocol";
import { buildChildEnv, FlightdeckError } from "../kernel/index.ts";
import { type PermissionBroker, parseSuggestions } from "../permissions/index.ts";
import { toolAllowed } from "../personas/model.ts";
import type { PersonaSnapshot } from "../personas/snapshot.ts";
import type { AgentRun, AgentRuntime, RuntimeEvent } from "../runtime/index.ts";
import type { EventStore } from "../store/index.ts";
import type { SessionManagerOptions } from "./session-options.ts";

/** Phase 39 (ADR 39-3): permission modes an OpenCode session does not offer. */
const OPENCODE_UNSUPPORTED_MODES: ReadonlySet<PermissionMode> = new Set([
  "acceptEdits",
  "dontAsk",
  "auto",
]);

export interface LiveSession {
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

/** What an OpenCode session cannot take, by name: a persona, or a permission mode it lacks. */
function unsupportedOnOpenCode(persona: unknown, mode: PermissionMode): string | null {
  if (persona) return "persona";
  return OPENCODE_UNSUPPORTED_MODES.has(mode) ? mode : null;
}

/** What the runs need from the manager that owns the sessions: its stores, its state, its events. */
export interface RunsContext {
  opts: SessionManagerOptions;
  store: EventStore;
  broker: PermissionBroker;
  live: Map<string, LiveSession>;
  efforts: Map<string, EffortLevel>;
  unattended: Set<string>;
  userListeners: Set<(sessionId: string, text: string) => void>;
  get(sessionId: string): SessionSummary;
  emit(sessionId: string, event: SessionEvent): void;
  setStatus(sessionId: string, status: SessionStatus, reason?: string): void;
  bypassAllowed(): boolean;
}

/** A session's agent run (#1595: out of the manager): started, fed its messages, failed. */
export class SessionRuns {
  constructor(private readonly ctx: RunsContext) {}

  /** Phase 39: an OpenCode session is refused before anything is created, so a refusal leaves no session. */
  async checkOpenCode(payload: CommandPayload<"session.create">, cwd: string): Promise<void> {
    const opencode = this.ctx.opts.opencode;
    if (!opencode) {
      throw new FlightdeckError(
        "invalid_state",
        "OpenCode is not available on this host",
        "runtime_unavailable",
      );
    }
    const mode = payload.permissionMode ?? this.ctx.opts.defaultPermissionMode;
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

  /** Phase 39: the runtime a stored session runs on. */
  runtimeOf(session: SessionSummary): AgentRuntime {
    if (session.runtime !== "opencode") return this.ctx.opts.runtime;
    if (!this.ctx.opts.opencode) {
      throw new FlightdeckError(
        "invalid_state",
        "OpenCode is not available on this host",
        "runtime_unavailable",
      );
    }
    return this.ctx.opts.opencode;
  }

  /** The answer to a tool request: denied outright for a free command in an unattended session or a tool the persona does not use, else asked of the person. */
  private canUse(
    sessionId: string,
    persona: ReturnType<EventStore["sessionPersona"]>,
    toolName: string,
    input: Record<string, unknown>,
    ctx: { signal: AbortSignal; suggestions?: unknown },
  ) {
    if (this.ctx.unattended.has(sessionId) && /(^|__)run_with_secret$/.test(toolName)) {
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
    return this.ctx.broker.request(
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
    const effort = this.ctx.efforts.get(sessionId);
    return {
      ...(resume ? { resume } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(persona ? { persona: personaOf(persona) } : {}),
      ...(agents && Object.keys(agents).length > 0 ? { agents } : {}),
    };
  }

  startRun(sessionId: string, resume?: string): LiveSession {
    const session = this.ctx.get(sessionId);
    // The persona the session opened with, as it was then: the prompt it appends is in no transcript.
    const persona = this.ctx.store.sessionPersona(sessionId);
    // What the session opened with: a later run reads no persona file.
    const agents = this.ctx.store.sessionAgents(sessionId);
    const run = this.runtimeOf(session).start({
      cwd: session.cwd,
      // The mode it last reported (#935): a new run never falls back to the start mode, which
      // stays only the limit of a change.
      permissionMode: this.ctx.store.lastMode(sessionId) ?? session.permissionMode,
      allowBypass: this.ctx.bypassAllowed(),
      // The session's own id: the Flightdeck MCP it opens knows who is sending (phase 21).
      env: {
        ...buildChildEnv(this.ctx.opts.baseEnv, this.ctx.opts.allowApiKey),
        FLIGHTDECK_SESSION: sessionId,
      },
      canUseTool: (toolName, input, ctx) => this.canUse(sessionId, persona, toolName, input, ctx),
      ...(this.ctx.opts.trust ? { trust: this.ctx.opts.trust(session.cwd) } : {}),
      ...this.optionalRunOptions(sessionId, session.model, resume, persona, agents),
    });
    const live: LiveSession = {
      run,
      queue: [],
      closing: false,
      trustedAtStart: this.ctx.opts.trust?.(session.cwd).trusted === true,
    };
    this.ctx.live.set(sessionId, live);
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
        this.ctx.store.updateSession(sessionId, {
          claudeSessionId: event.claudeSessionId,
          model: event.model,
        });
        this.ctx.emit(sessionId, event);
        if (this.ctx.get(sessionId).status === "starting") this.ctx.setStatus(sessionId, "running");
        if (live.pendingBefore) {
          this.turnEdge(sessionId, "before", live.pendingBefore.text, live.pendingBefore.uuid);
          live.pendingBefore = undefined;
        }
        return;
      case "quota":
        this.ctx.opts.onQuota?.(event.windows);
        return;
      case "turn.result": {
        // Before the event is stored: the usage reads the session's previous total.
        const session = this.ctx.get(sessionId);
        this.ctx.opts.onTurn?.(sessionId, session.cwd, event, session.runtime ?? "claude");
        this.turnEdge(sessionId, "after");
        this.ctx.emit(sessionId, event);
        const next = live.queue.shift();
        if (next !== undefined) this.deliver(sessionId, next.text, next.images);
        else this.ctx.setStatus(sessionId, "idle");
        return;
      }
      default:
        this.ctx.emit(sessionId, event);
    }
  }

  deliver(sessionId: string, text: string, images?: SessionImage[]): void {
    const live = this.ctx.live.get(sessionId);
    if (!live)
      throw new FlightdeckError(
        "invalid_state",
        "session has no active runtime",
        "session_not_running",
      );
    const status = this.ctx.get(sessionId).status;
    if (status !== "starting") this.ctx.setStatus(sessionId, "running");
    this.ctx.emit(sessionId, {
      type: "message.user",
      text,
      ...(images?.length ? { images: images.length } : {}),
    });
    for (const listener of this.ctx.userListeners) {
      try {
        listener(sessionId, text);
      } catch {
        // A broken listener must not break the session.
      }
    }
    const uuid = crypto.randomUUID();
    if (this.ctx.get(sessionId).claudeSessionId) this.turnEdge(sessionId, "before", text, uuid);
    else live.pendingBefore = { text, uuid };
    live.run.send(text, uuid, images);
  }

  private turnEdge(
    sessionId: string,
    kind: "before" | "after",
    prompt?: string,
    turnUuid?: string,
  ): void {
    const { claudeSessionId, cwd } = this.ctx.get(sessionId);
    if (!claudeSessionId) return;
    this.ctx.opts.onTurnEdge?.({
      sessionId,
      claudeSessionId,
      cwd,
      kind,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(turnUuid !== undefined ? { turnUuid } : {}),
    });
  }

  private fail(
    sessionId: string,
    live: LiveSession,
    code: string,
    message: string,
    typed?: { reason: string; params?: Record<string, string | number> },
  ): void {
    if (this.ctx.live.get(sessionId) === live) this.ctx.live.delete(sessionId);
    live.closing = true;
    this.ctx.broker.cancelSession(sessionId);
    this.ctx.emit(sessionId, { type: "session.error", code, message, ...typed });
    this.ctx.setStatus(sessionId, "error", message);
    void live.run.close();
  }
}
