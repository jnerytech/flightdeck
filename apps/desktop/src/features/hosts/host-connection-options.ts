import type {
  AccountState,
  AskpassRequest,
  BudgetUpdated,
  Card,
  ChangesUpdated,
  EventEnvelope,
  ExternalPermissionFrame,
  ExternalUpdated,
  HistoryChanged,
  MessagesRelayFrame,
  MessagesUpdatedFrame,
  MessagingAlertFrame,
  QuotaState,
  RunState,
  SessionEventOf,
  SessionSubscribeResult,
  TeamsUpdatedFrame,
  TerminalData,
  TerminalExited,
  TerminalResync,
  VaultAlertFrame,
  VaultRequestFrame,
  VaultUsed,
  WatchUpdatedFrame,
  WorkflowRun,
} from "@flightdeck/protocol";

export type ConnectionStatus =
  | "connecting"
  | "online"
  | "offline"
  | "unauthorized"
  /** The daemon does not speak this app's protocol: no retries until it is updated. */
  | "incompatible";

export interface HostConnectionOptions {
  url: string;
  token: string;
  clientName: string;
  /** The id of the host this connection belongs to: its refusals carry it. */
  hostId?: string;
  /** Called for every session event received (live or replayed). */
  onEvent(envelope: EventEnvelope): void;
  /**
   * #1191: every session's current summary at once, from the ack of `sessions.watch` on a host
   * that offers it; the live ones still come through `onEvent`.
   */
  onSummaries?(summaries: SessionEventOf<"session.summary">[]): void;
  onStatus(status: ConnectionStatus): void;
  /** Subscription acknowledged; events up to `result.session.lastSeq` are replay. */
  onSubscribed(sessionId: string, result: SessionSubscribeResult): void;
  /** A heartbeat arrived; `latencyMs` may have changed. */
  onPing?(): void;
  /** A card changed on the host's board (after `watchBoard`). */
  onCardUpdated?(card: Card): void;
  /** A transcript of the host gained lines (after `watchHistory`). */
  onHistoryChanged?(change: HistoryChanged): void;
  onAskpass?(request: AskpassRequest): void;
  /** An external session or one of its permission requests changed (after `watchExternal`). */
  onExternal?(frame: ExternalUpdated | ExternalPermissionFrame): void;
  /** The daemon asks the app for a secret (phase 16); the app decides. */
  onVaultRequest?(request: VaultRequestFrame): void;
  onVaultUsed?(used: VaultUsed): void;
  /** Phase 19: a warning about a secret's use, even where a rule let it through. */
  onVaultAlert?(alert: VaultAlertFrame): void;
  /** Phase 21: a message for another host to carry, or a message's new state. */
  onMessages?(frame: MessagesRelayFrame | MessagesUpdatedFrame): void;
  /** Phase 21: a team changed (and why, when the daemon paused or resumed it). */
  onTeams?(frame: TeamsUpdatedFrame): void;
  /** Phase 21: the daemon paused a pair of sessions caught in a loop. */
  onMessagingAlert?(alert: MessagingAlertFrame): void;
  /** Phase 22: a card's PR watch changed (a round started or ended, or it needs you). */
  onWatch?(frame: WatchUpdatedFrame): void;
  /** A workflow run of the host changed (after `watchRuns`). */
  onRunUpdated?(run: WorkflowRun): void;
  /** A card's run environment changed (after `watchRunEnv`, phase 24). */
  onRunEnvUpdated?(state: RunState): void;
  /** The host's plan quota changed (after `watchQuota`). */
  onQuotaUpdated?(state: QuotaState): void;
  /** The host's Claude account changed (after `watchAccount`, phase 34). */
  onAccountUpdated?(state: AccountState): void;
  /** A budget changed, crossed a threshold or entered a new period (after `watchBudgets`). */
  onBudgetUpdated?(update: BudgetUpdated): void;
  /** The diff of a watched target changed on disk (after `watchChanges`, phase 11). */
  onChangesUpdated?(update: ChangesUpdated): void;
  /** A frame of an attached terminal (after `terminal.attach`, phase 14). */
  onTerminal?(frame: TerminalData | TerminalExited | TerminalResync): void;
  /** Last persisted seq the app has seen for a session; used to resubscribe without gaps. */
  lastSeqFor(sessionId: string): number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Least time between two `wake()` calls that do something (focus spam must not storm the host). */
  wakeDebounceMs?: number;
  /** Silence from the host after which the link counts as dead (the daemon pings every 15 s). */
  staleMs?: number;
  /** How long a connection may take to get its `hello` answered before it is given up. */
  connectTimeoutMs?: number;
  /** Test seam: the watchdog's clock and interval (the real ones when absent). */
  watchdog?: { now(): number; repeat(check: () => void, ms: number): () => void };
}
