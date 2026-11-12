import {
  CLOSE_HEARTBEAT,
  CLOSE_UNAUTHORIZED,
  Command,
  CommandHeader,
  type CommandResults,
  type CommandType,
  MIN_PROTOCOL_VERSION,
  Pong,
  PROTOCOL_VERSION,
  WS_PATH,
} from "@flightdeck/protocol";
import { z } from "zod";
import {
  DAEMON_VERSION,
  DEFAULT_ALLOWED_NETWORKS,
  FlightdeckError,
  ipInNetworks,
  tokenMatches,
} from "./kernel/index.ts";
import { closeLine } from "./server/close-log.ts";
import { serverContext } from "./server/context.ts";
import { drainAll } from "./server/delta-coalescer.ts";
import { type Call, type Handler, runHandler } from "./server/dispatch.ts";
import { HANDLERS } from "./server/handlers/index.ts";
import { ackError, type Connection, decode, type Socket, send } from "./server/transport.ts";
import type { ServerOptions } from "./server-options.ts";

/**
 * How often the daemon pings each authenticated client. A client is closed after
 * `MAX_MISSED_PINGS` unanswered pings AND that many intervals without any frame from it: a page
 * starved of CPU may be late with its pongs, but anything it sends shows it is there.
 */
export const PING_INTERVAL_MS = 15_000;
const MAX_MISSED_PINGS = 4;

export type { ServerOptions };

export interface RunningServer {
  url: string;
  port: number;
  /** Switches to a new token and closes every connection authenticated with the old one. */
  setToken(token: string): void;
  stop(): Promise<void>;
}

export { tokenMatches };

export function startServer(opts: ServerOptions): RunningServer {
  const { manager } = opts;

  /** The daemon closes a connection and says why, for the close log (#1532). */
  const closeBy = (ws: Socket, cause: string, code: number, reason: string) => {
    ws.data.closedBy = cause;
    ws.close(code, reason);
  };
  const unauthorized = (ws: Socket) =>
    closeBy(ws, "unauthorized", CLOSE_UNAUTHORIZED, "unauthorized");
  const authed = new Set<Socket>();
  /** What every handler shares (issue #248), and one command's view of its socket. */
  const context = serverContext(opts);
  const call = (ws: Socket): Call => ({ ws, send: (frame) => send(ws, frame), server: context });
  let currentToken = opts.token;
  let pingSeq = 0;
  let connSeq = 0;

  const pingEveryMs = opts.pingIntervalMs ?? PING_INTERVAL_MS;
  const now = opts.now ?? (() => performance.now());
  const pingTicker =
    opts.pingTicker ??
    ((tick: () => void, everyMs: number) => {
      const timer = setInterval(tick, everyMs);
      return () => clearInterval(timer);
    });
  const stopHeartbeat = pingTicker(() => {
    for (const ws of authed) {
      const silentMs = now() - ws.data.lastFrameAt;
      if (
        ws.data.pendingPings.size >= MAX_MISSED_PINGS &&
        silentMs >= MAX_MISSED_PINGS * pingEveryMs
      ) {
        closeBy(ws, "heartbeat", CLOSE_HEARTBEAT, "heartbeat timeout");
        continue;
      }
      const id = String(++pingSeq);
      ws.data.pendingPings.set(id, now());
      const { lastRttMs } = ws.data;
      send(ws, { type: "ping", id, ...(lastRttMs !== undefined ? { lastRttMs } : {}) });
    }
  }, pingEveryMs);

  /** The daemon measures the round trip: the app cannot time a ping it did not send. */
  function onPong(ws: Socket, frame: unknown): void {
    const pong = Pong.safeParse(frame);
    const sentAt = pong.success ? ws.data.pendingPings.get(pong.data.id) : undefined;
    if (sentAt === undefined) return;
    ws.data.lastRttMs = Math.round(now() - sentAt);
    ws.data.lastPongAt = now();
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
    ws.data.client = parsed.data.payload.client;
    authed.add(ws);
    const data: CommandResults["hello"] = {
      hostName: opts.hostName,
      daemonVersion: DAEMON_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      allowedRoots: [...opts.allowedRoots],
      // #1191: `sessions.watch` can carry the current summaries in its ack.
      features: ["watch.snapshot"],
    };
    send(ws, { type: "ack", id: parsed.data.id, ok: true, data });
  }

  async function dispatch(ws: Socket, command: Command): Promise<void> {
    // The messaging service lists every endpoint with its project key, read synchronously.
    if (command.type.startsWith("messages.") || command.type.startsWith("teams.")) {
      await context.warmKeys([
        ...manager.list().map((s) => s.cwd),
        ...(opts.central?.external.list() ?? []).flatMap((s) => (s.cwd ? [s.cwd] : [])),
      ]);
    }

    // Issue #248: a command whose domain has moved runs its handler; the rest are still cases here.
    const handler = HANDLERS[command.type] as Handler<CommandType> | undefined;
    if (handler) return runHandler(handler, command as never, call(ws));

    switch (command.type) {
      case "hello":
        return onHello(ws, command);
    }
  }

  async function onCommand(ws: Socket, frame: unknown): Promise<void> {
    const header = CommandHeader.safeParse(frame);
    const id = header.success ? header.data.id : "";
    const parsed = Command.safeParse(frame);
    if (!parsed.success) {
      const field = (parsed.error.issues[0]?.path ?? []).filter((p) => p !== "payload").join(".");
      const command = header.success ? header.data.type : "";
      return ackError(
        ws,
        id,
        "bad_request",
        z.prettifyError(parsed.error),
        new FlightdeckError("bad_request", "", "request_invalid", { command, field }),
      );
    }
    try {
      await dispatch(ws, parsed.data);
    } catch (error) {
      if (error instanceof FlightdeckError)
        return ackError(ws, id, error.code, error.message, error);
      console.error(`[flightdeckd] erro em ${parsed.data.type}:`, error);
      ackError(ws, id, "internal", "internal daemon error");
    }
  }

  const server = Bun.serve<Connection>({
    hostname: opts.bind,
    port: opts.port,
    fetch(req, srv) {
      // Origin filter before anything else, on every route, before any upgrade.
      const origin = opts.peerOf ? opts.peerOf(req, srv) : (srv.requestIP(req)?.address ?? "");
      if (!ipInNetworks(origin, opts.allowedNetworks ?? DEFAULT_ALLOWED_NETWORKS)) {
        // Its own address, so a person told "refused" can add the right network (the doctor reads it).
        return new Response(`forbidden: ${origin}`, { status: 403 });
      }
      const url = new URL(req.url);
      if (url.pathname === WS_PATH) {
        const upgraded = srv.upgrade(req, {
          data: {
            authed: false,
            origin,
            subscriptions: new Map(),
            coalescers: new Set(),
            pendingPings: new Map(),
            lastFrameAt: now(),
            id: ++connSeq,
            connectedAt: now(),
            changeWatchers: new Map(),
          },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket esperado", { status: 426 });
      }
      if (url.pathname === "/health") return Response.json({ ok: true });
      return new Response("not found", { status: 404 });
    },
    websocket: {
      drain: drainAll,
      message(ws, raw) {
        ws.data.lastFrameAt = now();
        let frame: unknown;
        try {
          frame = decode(raw);
        } catch {
          if (!ws.data.authed) return unauthorized(ws);
          return ackError(ws, "", "bad_request", "invalid JSON");
        }
        // Before hello every frame, a pong included, goes to onHello (non-hello closes 4401).
        if (!ws.data.authed) return onHello(ws, frame);
        if ((frame as { type?: unknown } | null)?.type === "pong") return onPong(ws, frame);
        void onCommand(ws, frame);
      },
      close(ws, code, reason) {
        authed.delete(ws);
        const at = now();
        opts.log?.(
          closeLine(
            {
              id: ws.data.id,
              client: ws.data.client ?? null,
              code,
              reason,
              byDaemon: ws.data.closedBy ?? null,
              upMs: at - ws.data.connectedAt,
              silentMs: at - ws.data.lastFrameAt,
              pongAgoMs: ws.data.lastPongAt === undefined ? null : at - ws.data.lastPongAt,
            },
            currentToken,
          ),
        );
        ws.data.unwatch?.();
        ws.data.unwatchHistory?.();
        ws.data.unwatchBoard?.();
        ws.data.unwatchExternal?.();
        ws.data.unwatchRuns?.();
        ws.data.unwatchRunEnv?.();
        ws.data.unwatchQuota?.();
        ws.data.unwatchAccount?.();
        ws.data.unwatchAskpass?.();
        ws.data.unwatchBudgets?.();
        if (ws.data.terminalSink) opts.terminals?.detachAll(ws.data.terminalSink);
        for (const stop of ws.data.changeWatchers.values()) stop();
        ws.data.changeWatchers.clear();
        ws.data.unwatchVault?.();
        ws.data.unwatchMessages?.();
        ws.data.unwatchTeams?.();
        ws.data.unwatchPrs?.();
        ws.data.search?.abort();
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
      for (const ws of authed)
        closeBy(ws, "token rotated", CLOSE_UNAUTHORIZED, "token rotacionado");
    },
    stop: () => {
      stopHeartbeat();
      opts.agentSetup?.plugins?.close();
      return server.stop(true);
    },
  };
}
