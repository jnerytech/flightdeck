/**
 * Phase 30: sending webhooks politely. One queue per target, one send at a time, paced, with
 * retries and backoff, and a stop for a target the receiver will never accept.
 */
import type { NotifyEvent } from "./webhook-format.ts";

/** What a send gave back: the HTTP status, `null` when the request itself failed. */
export interface SendResult {
  status: number | null;
  /** The `Retry-After` the receiver asked for. */
  retryAfterMs?: number | null;
}

export interface QueueOptions {
  send(targetId: string, event: NotifyEvent): Promise<SendResult>;
  onResult(targetId: string, result: { ok: boolean; httpStatus: number | null }): void;
  /** Waits; injected so tests need no clock. */
  sleep(ms: number): Promise<void>;
  now?: () => number;
  /** `[0, 1)`, for the jitter. */
  random?: () => number;
  minIntervalMs?: number;
  /** Wait before each retry; the number of tries is one more than its length. */
  backoffMs?: number[];
  maxQueue?: number;
}

export class WebhookQueue {
  constructor(_options: QueueOptions) {}

  enqueue(_targetId: string, _event: NotifyEvent): void {}

  /** Lets a target that stopped on a permanent error try again (it was edited or tested). */
  unblock(_targetId: string): void {}

  stats(): { dropped: number; skipped: number } {
    return { dropped: -1, skipped: -1 };
  }

  async idle(): Promise<void> {}
}
