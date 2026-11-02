/**
 * Phase 30: sending webhooks politely. One queue per target, one send at a time, paced, with
 * retries and backoff, and a stop for a target the receiver will never accept.
 */
import { KIND_LABEL, type NotifyEvent } from "./webhook-format.ts";

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

interface Item {
  kind: NotifyEvent["kind"];
  events: NotifyEvent[];
}

interface TargetState {
  items: Item[];
  running: boolean;
  blocked: boolean;
  lastSendAt: number | null;
}

const DEFAULTS = { minIntervalMs: 1000, backoffMs: [2000, 8000, 32000], maxQueue: 100 };

/** A 3xx (never followed) or a 4xx that will not get better by waiting. */
const permanent = (status: number | null): boolean =>
  status !== null && status >= 300 && status < 500 && status !== 408 && status !== 429;

/** Several events of one kind that waited together become one message. */
function merged(events: NotifyEvent[]): NotifyEvent {
  const first = events[0] as NotifyEvent;
  const last = events[events.length - 1] as NotifyEvent;
  if (events.length === 1) return first;
  return {
    ...last,
    title: `${events.length} × ${KIND_LABEL[first.kind]}`,
    detail: events.map((e) => e.title).join("; "),
    summary: null,
    project: null,
  };
}

/** Waits `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WebhookQueue {
  private readonly targets = new Map<string, TargetState>();
  private readonly running = new Set<Promise<void>>();
  private dropped = 0;
  private skipped = 0;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly minIntervalMs: number;
  private readonly backoffMs: number[];
  private readonly maxQueue: number;

  constructor(private readonly options: QueueOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULTS.minIntervalMs;
    this.backoffMs = options.backoffMs ?? DEFAULTS.backoffMs;
    this.maxQueue = options.maxQueue ?? DEFAULTS.maxQueue;
  }

  private state(targetId: string): TargetState {
    let state = this.targets.get(targetId);
    if (!state) {
      state = { items: [], running: false, blocked: false, lastSendAt: null };
      this.targets.set(targetId, state);
    }
    return state;
  }

  enqueue(targetId: string, event: NotifyEvent): void {
    const state = this.state(targetId);
    if (state.blocked) {
      this.skipped++;
      return;
    }
    const waiting = state.items.find((item) => item.kind === event.kind);
    if (waiting) waiting.events.push(event);
    else state.items.push({ kind: event.kind, events: [event] });
    while (state.items.length > this.maxQueue) {
      this.dropped += (state.items.shift() as Item).events.length;
    }
    if (!state.running) {
      state.running = true;
      const run = this.drain(targetId, state).finally(() => this.running.delete(run));
      this.running.add(run);
    }
  }

  /** Lets a target that stopped on a permanent error try again (it was edited or tested). */
  unblock(targetId: string): void {
    this.state(targetId).blocked = false;
  }

  stats(): { dropped: number; skipped: number } {
    return { dropped: this.dropped, skipped: this.skipped };
  }

  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  private async pace(state: TargetState): Promise<void> {
    if (state.lastSendAt === null) return;
    const wait = this.minIntervalMs - (this.now() - state.lastSendAt);
    if (wait > 0) await this.options.sleep(wait);
  }

  private async drain(targetId: string, state: TargetState): Promise<void> {
    for (let item = state.items.shift(); item; item = state.items.shift()) {
      await this.deliver(targetId, state, merged(item.events));
    }
    state.running = false;
  }

  private async deliver(targetId: string, state: TargetState, event: NotifyEvent): Promise<void> {
    let result: SendResult = { status: null };
    for (let attempt = 0; attempt <= this.backoffMs.length; attempt++) {
      await this.pace(state);
      state.lastSendAt = this.now();
      try {
        result = await this.options.send(targetId, event);
      } catch {
        result = { status: null };
      }
      const ok = result.status !== null && result.status >= 200 && result.status < 300;
      if (ok || permanent(result.status) || attempt === this.backoffMs.length) {
        if (permanent(result.status)) state.blocked = true;
        this.options.onResult(targetId, { ok, httpStatus: result.status });
        return;
      }
      const base = (this.backoffMs[attempt] as number) * (0.75 + 0.5 * this.random());
      await this.options.sleep(Math.max(base, result.retryAfterMs ?? 0));
    }
  }
}
