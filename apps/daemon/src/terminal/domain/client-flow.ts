/**
 * Flow control of one terminal client's output: what is queued for it, when it falls behind and
 * has to resync, and when it is paused until it acknowledges what it drew. The functions update one
 * client's flow state and read the connection's backlog through a callback; the manager owns the
 * sink and the timers.
 */

/** What is held for one client whose connection is full, before it is asked to resync. */
const QUEUE_LIMIT_BYTES = 1024 * 1024;
/** A connection with more than this queued gets no more until it empties. */
const BACKLOG_LIMIT_BYTES = 1024 * 1024;
/** A flow-controlled client gets no more output while this much is unacknowledged. */
export const FLOW_HIGH_BYTES = 512 * 1024;
/** ...until it has acknowledged enough to be under this. */
export const FLOW_LOW_BYTES = 128 * 1024;
const BATCH_BYTES = 16 * 1024;

/** What flow control keeps for one client: its queue, the resync mark and the unacknowledged count. */
export interface ClientFlow {
  /** Output not yet sent to this client. */
  queue: Uint8Array[];
  queued: number;
  /** The queue overflowed: nothing goes to this client until it attaches again. */
  resync: boolean;
  /** The client acknowledges what it draws, and gets no more while too much is unacknowledged. */
  flow: boolean;
  /** Bytes sent and not acknowledged yet (only counted for a `flow` client). */
  unacked: number;
  /** `unacked` reached the high watermark and has not come down to the low one. */
  paused: boolean;
}

/** Holds `chunk` for a client; true when it overflowed what is kept for it and has to resync. */
export function enqueue(client: ClientFlow, chunk: Uint8Array, backlog: () => number): boolean {
  client.queue.push(chunk);
  client.queued += chunk.length;
  // Held back because the connection is full or the client is not drawing, and over what is
  // kept for it: it resyncs.
  const stalled = client.paused || backlog() > BACKLOG_LIMIT_BYTES;
  if (client.queued > QUEUE_LIMIT_BYTES && stalled) {
    client.queue = [];
    client.queued = 0;
    client.resync = true;
    return true;
  }
  return false;
}

/** The client drew `bytes` more; true when that brought a paused client back under the low mark. */
export function acknowledge(client: ClientFlow, bytes: number): boolean {
  client.unacked = Math.max(0, client.unacked - bytes);
  if (client.paused && client.unacked <= FLOW_LOW_BYTES) {
    client.paused = false;
    return true;
  }
  return false;
}

/** Whether a batch may go to the client now: it is in sync, not paused, has output and a free connection. */
export function canSend(client: ClientFlow, backlog: () => number): boolean {
  return !client.resync && !client.paused && client.queued > 0 && backlog() <= BACKLOG_LIMIT_BYTES;
}

/** Counts a batch of `bytes` as sent; a flow-controlled client pauses at the high mark. */
export function recordSent(client: ClientFlow, bytes: number): void {
  if (!client.flow) return;
  client.unacked += bytes;
  client.paused = client.unacked >= FLOW_HIGH_BYTES;
}

/** Output is kept for a client that is in sync. */
export function holdsOutput(client: ClientFlow): boolean {
  return !client.resync && client.queued > 0;
}

/** The next batch of at most 16 KB from a client's queue. */
export function takeBatch(client: ClientFlow): Uint8Array {
  const out = new Uint8Array(Math.min(BATCH_BYTES, client.queued));
  let filled = 0;
  while (filled < out.length) {
    const head = client.queue[0] as Uint8Array;
    const n = Math.min(head.length, out.length - filled);
    out.set(head.subarray(0, n), filled);
    filled += n;
    if (n === head.length) client.queue.shift();
    else client.queue[0] = head.subarray(n);
  }
  client.queued -= out.length;
  return out;
}
