import { createHash, timingSafeEqual } from "node:crypto";
import {
  type Ack,
  type CardUpdated,
  CLOSE_HEARTBEAT,
  CLOSE_UNAUTHORIZED,
  Command,
  CommandHeader,
  type CommandResults,
  type CommandType,
  type EventEnvelope,
  type ExternalPermissionFrame,
  type ExternalUpdated,
  type HistoryChanged,
  MIN_PROTOCOL_VERSION,
  type Ping,
  Pong,
  PROTOCOL_VERSION,
  type RunUpdated,
  WS_PATH,
} from "@flightdeck/protocol";
import type { ServerWebSocket } from "bun";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import type { Board } from "./board/board.ts";
import type { Central } from "./central/central.ts";
import { FlightdeckError } from "./errors.ts";
import type { HistoryIndexer } from "./history/indexer.ts";
import type { Maintenance } from "./maintenance/maintenance.ts";
import { DEFAULT_ALLOWED_NETWORKS, ipInNetworks } from "./networks.ts";
import type { SessionManager } from "./sessions/session-manager.ts";

export const DAEMON_VERSION: string = pkg.version;

/** How often the daemon pings each authenticated client; two unanswered pings close it. */
export const PING_INTERVAL_MS = 15_000;
const MAX_MISSED_PINGS = 2;

export interface ServerOptions {
  manager: SessionManager;
  hostName: string;
  bind: string;
  port: number;
  token: string;
  allowedRoots: readonly string[];
  /** CIDR ranges allowed to connect; defaults to loopback only. */
  allowedNetworks?: readonly string[];
  pingIntervalMs?: number;
  /** Transcript index behind the `history.*` commands. */
  history?: HistoryIndexer;
  /** Projects and cards behind the `project.*`, `board.*` and `card.*` commands. */
  board?: Board;
  /** External sessions and their permission requests (phase 5). */
  central?: Central;
  /** Retention and backups behind the `maintenance.*` commands (phase 7). */
  maintenance?: Maintenance;
  /** Client protocols accepted, `[min, max]`; `[MIN_PROTOCOL_VERSION, PROTOCOL_VERSION]` by default. */
  protocolRange?: readonly [number, number];
  /** What `host.info` announces; derived from what this daemon has when absent. */
  features?: string[];
  /** The `claude` executable reported by `host.info`; absent with the fake runtime. */
  claude?: { path: string | null; version(): Promise<string | null> };
}

export interface RunningServer {
  url: string;
  port: number;
  /** Switches to a new token and closes every connection authenticated with the old one. */
  setToken(token: string): void;
  stop(): Promise<void>;
}

interface Connection {
  authed: boolean;
  subscriptions: Map<string, () => void>;
  /** Pings sent and not yet answered, by id → send time. */
  pendingPings: Map<string, number>;
  /** Stops the `sessions.watch` stream, when active. */
  unwatch?: () => void;
  /** Stops the `history.watch` stream, when active. */
  unwatchHistory?: () => void;
  /** Stops the `board.watch` stream, when active. */
  unwatchBoard?: () => void;
  /** Stops the `external.watch` stream, when active. */
  unwatchExternal?: () => void;
  /** Stops the `run.watch` stream, when active. */
  unwatchRuns?: () => void;
  lastRttMs?: number;
}

type Socket = ServerWebSocket<Connection>;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time token comparison (hashing first keeps the lengths equal). */
export function tokenMatches(expected: string, given: string): boolean {
  return timingSafeEqual(digest(expected), digest(given));
}

type Outgoing =
  | Ack
  | EventEnvelope
  | Ping
  | HistoryChanged
  | CardUpdated
  | ExternalUpdated
  | ExternalPermissionFrame
  | RunUpdated;

function send(ws: Socket, message: Outgoing): void {
  ws.send(JSON.stringify(message));
}

function ackError(ws: Socket, id: string, code: string, message: string): void {
  send(ws, { type: "ack", id, ok: false, error: { code, message } });
}

function decode(raw: string | Buffer): unknown {
  return JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
}

export function startServer(opts: ServerOptions): RunningServer {
  const { manager } = opts;

  const unauthorized = (ws: Socket) => ws.close(CLOSE_UNAUTHORIZED, "unauthorized");
  const authed = new Set<Socket>();
  let currentToken = opts.token;
  const startedAt = Date.now();
  /** What this daemon has, as `host.info` announces it; the app hides what is missing. */
  const features = [
    ...(opts.central ? ["central"] : []),
    ...(opts.board ? ["workflows"] : []),
    ...(opts.maintenance ? ["maintenance"] : []),
  ];
  let pingSeq = 0;

  const heartbeat = setInterval(() => {
    for (const ws of authed) {
      if (ws.data.pendingPings.size >= MAX_MISSED_PINGS) {
        ws.close(CLOSE_HEARTBEAT, "heartbeat timeout");
        continue;
      }
      const id = String(++pingSeq);
      ws.data.pendingPings.set(id, performance.now());
      const { lastRttMs } = ws.data;
      send(ws, { type: "ping", id, ...(lastRttMs !== undefined ? { lastRttMs } : {}) });
    }
  }, opts.pingIntervalMs ?? PING_INTERVAL_MS);

  /** The daemon measures the round trip: the app cannot time a ping it did not send. */
  function onPong(ws: Socket, frame: unknown): void {
    const pong = Pong.safeParse(frame);
    const sentAt = pong.success ? ws.data.pendingPings.get(pong.data.id) : undefined;
    if (sentAt === undefined) return;
    ws.data.lastRttMs = Math.round(performance.now() - sentAt);
    ws.data.pendingPings.clear();
  }

  function onHello(ws: Socket, frame: unknown): void {
    const parsed = Command.safeParse(frame);
    if (!parsed.success || parsed.data.type !== "hello") {
      unauthorized(ws);
      return;
    }
    if (!tokenMatches(currentToken, parsed.data.payload.token)) {
      unauthorized(ws);
      return;
    }
    // Clients before phase 7 send no version: they speak protocol 1.
    const version = parsed.data.payload.protocolVersion ?? 1;
    const [min, max] = opts.protocolRange ?? [MIN_PROTOCOL_VERSION, PROTOCOL_VERSION];
    if (version < min || version > max) {
      // The connection stays open and unauthenticated: a compatible hello may follow.
      const message = `protocolo ${version} do cliente fora do intervalo do daemon [${min}, ${max}]`;
      ackError(ws, parsed.data.id, "protocol_incompatible", message);
      return;
    }
    ws.data.authed = true;
    authed.add(ws);
    const data: CommandResults["hello"] = {
      hostName: opts.hostName,
      daemonVersion: DAEMON_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      allowedRoots: [...opts.allowedRoots],
    };
    send(ws, { type: "ack", id: parsed.data.id, ok: true, data });
  }

  function history(): HistoryIndexer {
    if (!opts.history) throw new FlightdeckError("invalid_state", "histórico desativado");
    return opts.history;
  }

  function central() {
    if (!opts.central) throw new FlightdeckError("invalid_state", "central de sessões desativada");
    return opts.central;
  }

  /** Phase 5: every session list carries its project group and meta (with the hub on). */
  function listed<T extends { cwd: string }>(session: T, claudeSessionId: string | null): T {
    const hub = opts.central;
    if (!hub) return session;
    return {
      ...session,
      projectKey: hub.projectKey(session.cwd),
      meta: hub.meta.get(claudeSessionId ?? ""),
    };
  }

  function maintenance(): Maintenance {
    if (!opts.maintenance) throw new FlightdeckError("invalid_state", "manutenção indisponível");
    return opts.maintenance;
  }

  function board(): Board {
    if (!opts.board) throw new FlightdeckError("invalid_state", "board desativado");
    return opts.board;
  }

  function subscribe(ws: Socket, sessionId: string, sinceSeq: number) {
    ws.data.subscriptions.get(sessionId)?.();
    const sub = manager.subscribe(sessionId, sinceSeq, (envelope) => send(ws, envelope));
    ws.data.subscriptions.set(sessionId, sub.unsubscribe);
    return sub;
  }

  async function dispatch(ws: Socket, command: Command): Promise<void> {
    const ok = <T extends CommandType>(_type: T, data?: CommandResults[T]) =>
      send(ws, { type: "ack", id: command.id, ok: true, ...(data !== undefined ? { data } : {}) });

    switch (command.type) {
      case "hello":
        return onHello(ws, command);
      case "session.list":
        return ok(command.type, {
          sessions: manager.list().map((s) => listed(s, s.claudeSessionId)),
        });
      case "session.create":
        return ok(command.type, manager.create(command.payload));
      case "session.send":
        return ok(command.type, manager.send(command.payload.sessionId, command.payload.text));
      case "session.interrupt":
        await manager.interrupt(command.payload.sessionId);
        return ok(command.type);
      case "session.close":
        await manager.close(command.payload.sessionId);
        return ok(command.type);
      case "session.resume":
        await manager.resume(command.payload.sessionId);
        return ok(command.type);
      case "session.subscribe": {
        // Ack, replay and live registration happen in one synchronous step: no gap, no dupes.
        const sub = subscribe(ws, command.payload.sessionId, command.payload.sinceSeq ?? 0);
        ok(command.type, { session: sub.session, replayed: sub.replay.length });
        for (const envelope of sub.replay) send(ws, envelope);
        return;
      }
      case "session.unsubscribe":
        ws.data.subscriptions.get(command.payload.sessionId)?.();
        ws.data.subscriptions.delete(command.payload.sessionId);
        return ok(command.type);
      case "permission.respond": {
        // External requests (ids `ext-…`) are held hooks; anything else is a managed session's.
        const { requestId, decision, message } = command.payload;
        if (!opts.central?.permissions.respond(requestId, decision, message)) {
          manager.respondPermission(command.payload);
        }
        return ok(command.type);
      }
      case "external.message": {
        const { claudeSessionId, text } = command.payload;
        const { external, receptor } = central();
        const session = external.get(claudeSessionId);
        if (!session)
          throw new FlightdeckError("not_found", `sessão ${claudeSessionId} não existe`);
        const sent = session.launchId ? receptor?.sendToLaunch(session.launchId, text) : false;
        if (!sent) {
          throw new FlightdeckError(
            "invalid_state",
            "sessão sem canal: só sessões abertas com flightdeckd claude recebem mensagens",
          );
        }
        return ok(command.type);
      }
      case "session.meta.set": {
        const { claudeSessionId, ...patch } = command.payload;
        const meta = central().meta.set(claudeSessionId, patch);
        return ok(command.type, { claudeSessionId, ...meta });
      }
      case "maintenance.status":
        return ok(command.type, maintenance().status());
      case "maintenance.backup":
        return ok(command.type, maintenance().backupNow());
      case "maintenance.prune":
        return ok(command.type, maintenance().prune(command.payload.dryRun === true));
      case "hooks.status":
        return ok(command.type, central().hooksStatus());
      case "hooks.install":
        return ok(command.type, central().hooksInstall(command.payload.confirm === true));
      case "hooks.uninstall":
        return ok(command.type, central().hooksUninstall(command.payload.confirm === true));
      case "external.list": {
        const { external, meta } = central();
        const sessions = external.list().map((s) => ({ ...s, meta: meta.get(s.claudeSessionId) }));
        return ok(command.type, { sessions });
      }
      case "external.watch": {
        // Ack, then the live sessions and the open requests, then every change: no gap.
        const { external, permissions } = central();
        ws.data.unwatchExternal?.();
        const offSessions = external.onChange((session) =>
          send(ws, { type: "external.updated", session }),
        );
        const offPermissions = permissions.watch((frame) => send(ws, frame));
        ws.data.unwatchExternal = () => {
          offSessions();
          offPermissions();
        };
        ok(command.type);
        for (const session of external.list()) send(ws, { type: "external.updated", session });
        for (const frame of permissions.open()) send(ws, frame);
        return;
      }
      case "host.info":
        return ok(command.type, {
          hostName: opts.hostName,
          os: process.platform,
          arch: process.arch,
          daemonVersion: DAEMON_VERSION,
          claudeVersion: (await opts.claude?.version()) ?? null,
          claudePath: opts.claude?.path ?? null,
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          activeSessions: manager.activeSessionCount(),
          apiKeySanitized: manager.apiKeySanitized(),
          features: opts.features ?? features,
        });
      case "history.list": {
        const page = history().list(command.payload);
        const sessions = page.sessions.map((s) => listed(s, s.claudeSessionId));
        return ok(command.type, { ...page, sessions });
      }
      case "history.get": {
        const { claudeSessionId, cursor, limit } = command.payload;
        return ok(command.type, history().get(claudeSessionId, cursor, limit));
      }
      case "history.search": {
        const index = history();
        const hits = index.search(command.payload).map((hit) => ({
          ...hit,
          cursor: index.cursorFor(hit.claudeSessionId, hit.uuid),
        }));
        return ok(command.type, { hits });
      }
      case "history.resume": {
        const { claudeSessionId, force, name, permissionMode } = command.payload;
        const session = history().session(claudeSessionId);
        if (!session) {
          throw new FlightdeckError("not_found", `transcript ${claudeSessionId} não indexado`);
        }
        if (session.maybeActive && !force) {
          throw new FlightdeckError(
            "invalid_state",
            "sessão possivelmente em uso em outro lugar; envie force: true para retomar mesmo assim",
          );
        }
        return ok(
          command.type,
          manager.createResumed({
            cwd: session.cwd,
            claudeSessionId,
            name: name ?? session.title,
            ...(permissionMode ? { permissionMode } : {}),
          }),
        );
      }
      case "history.watch": {
        const index = history();
        ws.data.unwatchHistory?.();
        ws.data.unwatchHistory = index.onChange((change) =>
          send(ws, { type: "history.changed", ...change }),
        );
        return ok(command.type);
      }
      case "project.list":
        return ok(command.type, {
          projects: board().listProjects(),
          maxParallelRuns: board().maxParallelRuns,
        });
      case "project.add":
        return ok(command.type, await board().addProject(command.payload));
      case "project.update": {
        const { projectId, ...patch } = command.payload;
        return ok(command.type, board().updateProject(projectId, patch));
      }
      case "board.get":
        return ok(command.type, board().getBoard(command.payload.projectId));
      case "board.settings": {
        const { maxParallelRuns } = command.payload;
        if (maxParallelRuns !== undefined) board().setMaxParallelRuns(maxParallelRuns);
        return ok(command.type, { maxParallelRuns: board().maxParallelRuns });
      }
      case "board.watch": {
        const cards = board();
        ws.data.unwatchBoard?.();
        ws.data.unwatchBoard = cards.watch((card) => send(ws, { type: "card.updated", card }));
        return ok(command.type);
      }
      case "card.create": {
        const { projectId, title, description } = command.payload;
        return ok(command.type, board().createCard(projectId, { title, description }));
      }
      case "card.update": {
        const { cardId, ...patch } = command.payload;
        return ok(command.type, board().updateCard(cardId, patch));
      }
      case "card.move": {
        const { cardId, column, position } = command.payload;
        return ok(command.type, board().moveCard(cardId, column, position));
      }
      case "card.get":
        return ok(command.type, board().getCard(command.payload.cardId));
      case "workflow.list":
        return ok(command.type, {
          workflows: await board().listWorkflows(command.payload.projectId),
        });
      case "workflow.validate": {
        const { projectId, name } = command.payload;
        return ok(command.type, await board().validateWorkflow(projectId, name));
      }
      case "workflow.trust": {
        const { projectId, name, hash } = command.payload;
        return ok(command.type, await board().trustWorkflow(projectId, name, hash));
      }
      case "run.get":
        return ok(command.type, board().workflows.getRun(command.payload.runId));
      case "gate.respond": {
        const { runId, stepId, attempt, decision, note } = command.payload;
        board().workflows.respond(runId, stepId, attempt, decision, note);
        return ok(command.type, board().workflows.getRun(runId));
      }
      case "run.watch": {
        // Ack, the runs still going, then every change: the app sees open gates right away.
        const runs = board().workflows;
        ws.data.unwatchRuns?.();
        ws.data.unwatchRuns = runs.watch((run) => send(ws, { type: "run.updated", run }));
        ok(command.type);
        for (const run of runs.activeRuns()) send(ws, { type: "run.updated", run });
        return;
      }
      case "card.start": {
        const { cardId, workflow, inputs } = command.payload;
        return ok(command.type, await board().startCard(cardId, { workflow, inputs }));
      }
      case "card.stop":
        return ok(command.type, await board().stopCard(command.payload.cardId));
      case "card.diff":
        return ok(command.type, await board().diff(command.payload.cardId));
      case "card.message":
        return ok(command.type, board().message(command.payload.cardId, command.payload.text));
      case "card.pr.create":
        return ok(command.type, await board().createPr(command.payload.cardId));
      case "card.complete": {
        const { cardId, confirm } = command.payload;
        return ok(command.type, await board().completeCard(cardId, confirm === true));
      }
      case "card.discard": {
        const { cardId, confirm } = command.payload;
        return ok(command.type, await board().discardCard(cardId, confirm === true));
      }
      case "sessions.watch": {
        // Same pattern as subscribe: ack, current summaries, then live ones, with no gap.
        ws.data.unwatch?.();
        const watch = manager.watchSummaries((envelope) => send(ws, envelope));
        ws.data.unwatch = watch.unwatch;
        ok(command.type);
        for (const envelope of watch.snapshot) send(ws, envelope);
        return;
      }
    }
  }

  async function onCommand(ws: Socket, frame: unknown): Promise<void> {
    const header = CommandHeader.safeParse(frame);
    const id = header.success ? header.data.id : "";
    const parsed = Command.safeParse(frame);
    if (!parsed.success) {
      return ackError(ws, id, "bad_request", z.prettifyError(parsed.error));
    }
    try {
      await dispatch(ws, parsed.data);
    } catch (error) {
      if (error instanceof FlightdeckError) return ackError(ws, id, error.code, error.message);
      console.error(`[flightdeckd] erro em ${parsed.data.type}:`, error);
      ackError(ws, id, "internal", "erro interno do daemon");
    }
  }

  const server = Bun.serve<Connection>({
    hostname: opts.bind,
    port: opts.port,
    fetch(req, srv) {
      // Origin filter before anything else, on every route, before any upgrade.
      const origin = srv.requestIP(req)?.address ?? "";
      if (!ipInNetworks(origin, opts.allowedNetworks ?? DEFAULT_ALLOWED_NETWORKS)) {
        return new Response("forbidden", { status: 403 });
      }
      const url = new URL(req.url);
      if (url.pathname === WS_PATH) {
        const upgraded = srv.upgrade(req, {
          data: { authed: false, subscriptions: new Map(), pendingPings: new Map() },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket esperado", { status: 426 });
      }
      if (url.pathname === "/health") return Response.json({ ok: true });
      return new Response("not found", { status: 404 });
    },
    websocket: {
      message(ws, raw) {
        let frame: unknown;
        try {
          frame = decode(raw);
        } catch {
          if (!ws.data.authed) return unauthorized(ws);
          return ackError(ws, "", "bad_request", "JSON inválido");
        }
        // Before hello every frame, a pong included, goes to onHello (non-hello closes 4401).
        if (!ws.data.authed) return onHello(ws, frame);
        if ((frame as { type?: unknown } | null)?.type === "pong") return onPong(ws, frame);
        void onCommand(ws, frame);
      },
      close(ws) {
        authed.delete(ws);
        ws.data.unwatch?.();
        ws.data.unwatchHistory?.();
        ws.data.unwatchBoard?.();
        ws.data.unwatchExternal?.();
        ws.data.unwatchRuns?.();
        for (const unsubscribe of ws.data.subscriptions.values()) unsubscribe();
        ws.data.subscriptions.clear();
      },
    },
  });

  const port = server.port ?? opts.port;
  const host = opts.bind.includes(":") ? `[${opts.bind}]` : opts.bind;
  return {
    url: `ws://${host}:${port}${WS_PATH}`,
    port,
    setToken(token) {
      if (token === currentToken) return;
      currentToken = token;
      // Only one token is valid at a time, so every authenticated client used the old one.
      for (const ws of authed) ws.close(CLOSE_UNAUTHORIZED, "token rotacionado");
    },
    stop: () => {
      clearInterval(heartbeat);
      return server.stop(true);
    },
  };
}
