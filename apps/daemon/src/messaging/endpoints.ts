/**
 * Phase 21: what the messaging layer needs of the sessions of this host. The real adapter reads
 * the session manager, the cards and the terminal sessions of the central hub; tests hand in a
 * fake. A session is addressed by its id: the managed id, or the Claude session id of a terminal.
 */
import { readFileSync } from "node:fs";
import type {
  ExternalStatus,
  MessagingSession,
  SessionLine,
  SessionStatus,
  SessionSummary,
} from "@flightdeck/protocol";
import type { ExternalSessions } from "../central/external.ts";
import { FlightdeckError } from "../errors.ts";
import { MAX_TEXT_BYTES, parseLines, truncateUtf8 } from "../history/parser.ts";
import { requestLine } from "../history/session-line.ts";
import type { AutoApprover } from "../permissions/auto-approve.ts";
import type { SessionManager } from "../sessions/session-manager.ts";

export interface EndpointInfo {
  id: string;
  /** `card` is a managed session of a card; `plain` is a terminal claude with no channel. */
  kind: MessagingSession["kind"];
  name: string | null;
  persona: string | null;
  projectKey: string | null;
  state: MessagingSession["state"];
  /** Whether it takes messages; `reason` says why not. */
  controllable: boolean;
  reason: string | null;
}

export interface ReadMessage {
  role: "user" | "assistant";
  text: string;
}

export interface Endpoints {
  list(): EndpointInfo[];
  /** The session a terminal launch (`FLIGHTDECK_LAUNCH_ID`) is, if it started one. */
  byLaunch(launchId: string): string | null;
  /**
   * Hands the text to the session. `delivered`: it is in the session; `queued`: the session is in
   * a turn and takes it when the turn ends. Throws a `FlightdeckError` when it cannot take it.
   */
  send(id: string, text: string): "delivered" | "queued";
  /** Whether third-party content reached the session (phase 13). */
  untrusted(id: string): boolean;
  /** Suspends the automatic approval in the session. */
  suspend(id: string, reason: string): void;
  /** A turn ended (managed) or the terminal session stopped. */
  onIdle(listener: (id: string) => void): () => void;
  /** A user message reached a managed session (a queued message is delivered then). */
  onUserMessage(listener: (id: string, text: string) => void): () => void;
  /** A session changed state (a held message goes when a terminal leaves `waiting`). */
  onState(listener: (id: string, state: MessagingSession["state"]) => void): () => void;
  /** The summary and the last messages of the transcript, or null for a session that is not known. */
  read(id: string, last: number): { summary: SessionLine | null; messages: ReadMessage[] } | null;
}

/** What the real adapter reads of this host. */
export interface LocalEndpointsOptions {
  manager: SessionManager;
  external: ExternalSessions;
  /** The name the user gave a session (managed or terminal), by Claude session id. */
  nameOf: (claudeSessionId: string) => string | null;
  projectKey: (cwd: string) => string;
  /** The card a managed session works for, if any. */
  cardOf: (sessionId: string) => string | null;
  /** Writes to the channel of a terminal launch; false when there is none. */
  sendToLaunch: (launchId: string, text: string) => boolean;
  autoApprove?: Pick<AutoApprover, "suspend" | "suspended"> | undefined;
  personaOf?: ((sessionId: string) => string | null) | undefined;
  /** The text of a transcript file; null when it cannot be read. */
  readFile?: ((path: string) => string | null) | undefined;
}

const MANAGED_STATE: Record<SessionStatus, MessagingSession["state"]> = {
  starting: "running",
  running: "running",
  awaiting_permission: "waiting",
  idle: "idle",
  ended: "ended",
  error: "ended",
};

const TERMINAL_STATE: Record<ExternalStatus, MessagingSession["state"]> = {
  idle: "idle",
  running: "running",
  awaiting_permission: "waiting",
  ended: "ended",
  unknown: "running",
};

const PLAIN_REASON = "claude puro, sem canal: só recebe pela troca nativa do Claude Code";
const ENDED_REASON = "a sessão terminou";
/** `read_session` shows at most this many messages, each cut to 8 KB. */
const MAX_READ = 20;

const defaultRead = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export class LocalEndpoints implements Endpoints {
  private readonly last = new Map<string, MessagingSession["state"]>();
  private readonly idleListeners = new Set<(id: string) => void>();
  private readonly stateListeners = new Set<
    (id: string, state: MessagingSession["state"]) => void
  >();
  private readonly offs: Array<() => void> = [];

  constructor(private readonly opts: LocalEndpointsOptions) {
    this.offs.push(
      opts.manager.watchSummaries((envelope) => {
        const event = envelope.event;
        if (event.type === "session.summary") {
          this.changed(event.sessionId, MANAGED_STATE[event.status]);
        }
      }).unwatch,
      opts.external.onChange((session) =>
        this.changed(session.claudeSessionId, TERMINAL_STATE[session.status]),
      ),
    );
  }

  /** A state change: tells the listeners once per transition. */
  private changed(id: string, state: MessagingSession["state"]): void {
    if (this.last.get(id) === state) return;
    this.last.set(id, state);
    for (const listener of this.stateListeners) listener(id, state);
    if (state === "idle") for (const listener of this.idleListeners) listener(id);
  }

  private managed(): SessionSummary[] {
    return this.opts.manager.list();
  }

  list(): EndpointInfo[] {
    const managed = this.managed();
    const ids = new Set(managed.map((s) => s.claudeSessionId).filter(Boolean));
    const infos: EndpointInfo[] = managed.map((s) => {
      const state = MANAGED_STATE[s.status];
      return {
        id: s.id,
        kind: this.opts.cardOf(s.id) ? "card" : "managed",
        name: (s.claudeSessionId && this.opts.nameOf(s.claudeSessionId)) || s.name,
        persona: this.opts.personaOf?.(s.id) ?? null,
        projectKey: this.opts.projectKey(s.cwd),
        state,
        controllable: state !== "ended",
        reason: state === "ended" ? ENDED_REASON : null,
      };
    });
    for (const s of this.opts.external.list()) {
      if (ids.has(s.claudeSessionId)) continue;
      const state = TERMINAL_STATE[s.status];
      const controllable = s.controllable && state !== "ended";
      infos.push({
        id: s.claudeSessionId,
        kind: s.controllable ? "terminal" : "plain",
        name: this.opts.nameOf(s.claudeSessionId),
        persona: this.opts.personaOf?.(s.claudeSessionId) ?? null,
        projectKey: s.cwd ? this.opts.projectKey(s.cwd) : s.projectKey,
        state,
        controllable,
        reason: controllable ? null : state === "ended" ? ENDED_REASON : PLAIN_REASON,
      });
    }
    return infos;
  }

  byLaunch(launchId: string): string | null {
    return this.opts.external.sessionForLaunch(launchId);
  }

  send(id: string, text: string): "delivered" | "queued" {
    if (this.managed().some((s) => s.id === id)) {
      return this.opts.manager.send(id, text).queued ? "queued" : "delivered";
    }
    const terminal = this.opts.external.get(id);
    if (!terminal) throw new FlightdeckError("not_found", `sessão ${id} não existe`);
    if (!terminal.controllable || !terminal.launchId) {
      throw new FlightdeckError("invalid_state", PLAIN_REASON);
    }
    if (!this.opts.sendToLaunch(terminal.launchId, text)) {
      throw new FlightdeckError("invalid_state", "o canal do terminal não está conectado");
    }
    return "delivered";
  }

  /** The keys the automatic approval knows a session by. */
  private keys(id: string): string[] {
    const card = this.opts.cardOf(id);
    return card ? [id, `card:${card}`] : [id];
  }

  untrusted(id: string): boolean {
    const keys = this.keys(id);
    return (this.opts.autoApprove?.suspended() ?? []).some((s) => keys.includes(s.sessionKey));
  }

  suspend(id: string, reason: string): void {
    for (const key of this.keys(id)) this.opts.autoApprove?.suspend(key, reason);
  }

  onIdle(listener: (id: string) => void): () => void {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
  }

  onUserMessage(listener: (id: string, text: string) => void): () => void {
    return this.opts.manager.onUserMessage(listener);
  }

  onState(listener: (id: string, state: MessagingSession["state"]) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  read(id: string, last: number): { summary: SessionLine | null; messages: ReadMessage[] } | null {
    const count = Math.max(1, Math.min(last, MAX_READ));
    const info = this.list().find((e) => e.id === id);
    if (!info) return null;
    let messages: ReadMessage[] = [];
    let since: string | null = null;
    if (this.managed().some((s) => s.id === id)) {
      const events = this.opts.manager.eventsSince(id, 0);
      for (const { event } of events) {
        if (event.type === "message.user") messages.push({ role: "user", text: event.text });
        else if (event.type === "message.assistant") {
          const text = event.blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
          if (text) messages.push({ role: "assistant", text });
        }
      }
      since = this.opts.manager.get(id).updatedAt;
    } else {
      const terminal = this.opts.external.get(id);
      const text = terminal?.transcriptPath
        ? (this.opts.readFile ?? defaultRead)(terminal.transcriptPath)
        : null;
      if (text) {
        for (const record of parseLines(text).records) {
          if (
            record.kind === "message" &&
            (record.role === "user" || record.role === "assistant")
          ) {
            messages.push({ role: record.role, text: record.text });
          }
        }
      }
      since = terminal?.lastEventAt ?? null;
    }
    messages = messages
      .slice(-count)
      .map((m) => ({ role: m.role, text: truncateUtf8(m.text, MAX_TEXT_BYTES) }));
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const summary: SessionLine = {
      request: lastUser ? requestLine(lastUser.text) || null : null,
      state: info.state,
      tool: null,
      since,
    };
    return { summary, messages };
  }

  stop(): void {
    for (const off of this.offs.splice(0)) off();
  }
}
