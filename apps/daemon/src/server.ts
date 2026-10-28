import { createHash, timingSafeEqual } from "node:crypto";
import {
  type Ack,
  CLOSE_HEARTBEAT,
  CLOSE_UNAUTHORIZED,
  Command,
  CommandHeader,
  type CommandResults,
  type CommandType,
  type EventEnvelope,
  type Ping,
  Pong,
  PROTOCOL_VERSION,
  WS_PATH,
} from "@flightdeck/protocol";
import type { ServerWebSocket } from "bun";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { FlightdeckError } from "./errors.ts";
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
}

export interface RunningServer {
  url: string;
  port: number;
  stop(): Promise<void>;
}

interface Connection {
  authed: boolean;
  subscriptions: Map<string, () => void>;
  /** Pings sent and not yet answered, by id → send time. */
  pendingPings: Map<string, number>;
  lastRttMs?: number;
}

type Socket = ServerWebSocket<Connection>;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time token comparison (hashing first keeps the lengths equal). */
export function tokenMatches(expected: string, given: string): boolean {
  return timingSafeEqual(digest(expected), digest(given));
}

function send(ws: Socket, message: Ack | EventEnvelope | Ping): void {
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
    if (!tokenMatches(opts.token, parsed.data.payload.token)) {
      unauthorized(ws);
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
        return ok(command.type, { sessions: manager.list() });
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
      case "permission.respond":
        manager.respondPermission(command.payload);
        return ok(command.type);
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
    stop: () => {
      clearInterval(heartbeat);
      return server.stop(true);
    },
  };
}
