/**
 * Issue #248: what the server's transport and its handlers share: a connection's state, the frames
 * the daemon sends, and how an ack error is written. Handler modules import these from here, never
 * a value from `server.ts`.
 */
import type {
  AccountUpdated,
  Ack,
  AskpassRequest,
  BudgetUpdated,
  CardUpdated,
  ChangesUpdated,
  EventEnvelope,
  ExternalPermissionFrame,
  ExternalUpdated,
  HistoryChanged,
  IdleFiredFrame,
  MessagesRelayFrame,
  MessagesUpdatedFrame,
  MessagingAlertFrame,
  Ping,
  QuotaUpdated,
  RunEnvUpdated,
  RunUpdated,
  TeamsUpdatedFrame,
  TerminalData,
  TerminalExited,
  TerminalResync,
  VaultAlertFrame,
  VaultRequestFrame,
  VaultUsed,
  WatchUpdatedFrame,
} from "@flightdeck/protocol";
import type { ServerWebSocket } from "bun";
import type { DeltaCoalescer } from "../delta-coalescer.ts";
import type { FlightdeckError } from "../errors.ts";
import type { TerminalSink } from "../terminal/terminal-manager.ts";
import { sendFrame } from "../ws-send.ts";

export interface Connection {
  authed: boolean;
  /** Where the connection came from (the address the origin filter looked at). */
  origin: string;
  subscriptions: Map<string, () => void>;
  /** One per subscription: the text that waits for its window or for the socket to drain. */
  coalescers: Set<DeltaCoalescer>;
  /** A frame was dropped: the client was cut off and gets nothing more (`sendFrame`). */
  dropped?: boolean;
  /** Pings sent and not yet answered, by id → send time. */
  pendingPings: Map<string, number>;
  /** When the last frame of any kind arrived from this client (`performance.now()`). */
  lastFrameAt: number;
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
  unwatchRunEnv?: () => void;
  /** Stops the `quota.watch` stream, when active. */
  unwatchQuota?: () => void;
  /** Stops the `account.watch` stream, when active. */
  unwatchAccount?: () => void;
  /** Stops the `askpass.watch` stream, when active. */
  unwatchAskpass?: () => void;
  /** Stops the `budget.watch` stream, when active. */
  unwatchBudgets?: () => void;
  /** Stops each `changes.watch`, by target. */
  changeWatchers: Map<string, () => void>;
  /** This connection's end of the terminals it is attached to. */
  terminalSink?: TerminalSink;
  /** Stops the `vault.watch` stream, when active. */
  unwatchVault?: () => void;
  /** Stops the `messages.watch` stream, when active. */
  unwatchMessages?: () => void;
  /** Stops the `teams.watch` stream, when active. */
  unwatchTeams?: () => void;
  /** Stops the `watch.watch` stream, when active. */
  unwatchPrs?: () => void;
  lastRttMs?: number;
}

export type Socket = ServerWebSocket<Connection>;

export type Outgoing =
  | Ack
  | EventEnvelope
  | Ping
  | HistoryChanged
  | CardUpdated
  | ExternalUpdated
  | ExternalPermissionFrame
  | RunUpdated
  | AccountUpdated
  | RunEnvUpdated
  | QuotaUpdated
  | BudgetUpdated
  | ChangesUpdated
  | TerminalData
  | TerminalExited
  | TerminalResync
  | AskpassRequest
  | VaultUsed
  | VaultRequestFrame
  | VaultAlertFrame
  | MessagesUpdatedFrame
  | MessagesRelayFrame
  | MessagingAlertFrame
  | IdleFiredFrame
  | TeamsUpdatedFrame
  | WatchUpdatedFrame;

export function send(ws: Socket, message: Outgoing): void {
  sendFrame(ws, message);
}

export function ackError(
  ws: Socket,
  id: string,
  code: string,
  message: string,
  why: Pick<FlightdeckError, "reason" | "params" | "items"> = {},
): void {
  const { reason, params, items } = why;
  send(ws, {
    type: "ack",
    id,
    ok: false,
    error: {
      code,
      message,
      ...(reason ? { reason, params: params ?? {} } : {}),
      ...(items ? { items: [...items] } : {}),
    },
  });
}

export function decode(raw: string | Buffer): unknown {
  return JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
}
