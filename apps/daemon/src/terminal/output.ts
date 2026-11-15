import type { TerminalData, TerminalExited, TerminalResync } from "@flightdeck/protocol";
import {
  acknowledge,
  type ClientFlow,
  canSend,
  enqueue,
  holdsOutput,
  recordSent,
  takeBatch,
} from "./domain/client-flow.ts";
import { Ring } from "./domain/ring.ts";

/** What the manager sends a connected client. */
export type TerminalFrame = TerminalData | TerminalExited | TerminalResync;

/** One connection's end of its attached terminals. */
export interface TerminalSink {
  send(frame: TerminalFrame): void;
  /** Bytes the connection has queued and not yet sent (`ws.getBufferedAmount()`). */
  backlog(): number;
}

interface Client extends ClientFlow {
  sink: TerminalSink;
  exitSent: boolean;
}

/**
 * The output of one terminal: the ring that keeps its scrollback (the source of truth) and one
 * bounded queue per attached client. Bun's PTY cannot pause reading, so a client too slow to
 * follow is told to `resync`: it attaches again and continues from the ring. The manager owns the
 * timer that calls `flush`, and the life of the process.
 */
export class TerminalOutput {
  private readonly ring: Ring;
  private readonly clients = new Map<TerminalSink, Client>();

  constructor(
    private readonly terminalId: string,
    scrollbackBytes: number,
  ) {
    this.ring = new Ring(scrollbackBytes);
  }

  /** How many connections follow the terminal. */
  get attached(): number {
    return this.clients.size;
  }

  has(sink: TerminalSink): boolean {
    return this.clients.has(sink);
  }

  sinks(): TerminalSink[] {
    return [...this.clients.keys()];
  }

  /**
   * The connection follows the terminal from now on; attaching again (after a `resync`) starts its
   * queue over. Returns base64 of the scrollback, the position to continue from. `exited`: the
   * result already says the process ended, so no end frame follows.
   */
  attach(sink: TerminalSink, flow: boolean, exited: boolean): string {
    this.clients.set(sink, {
      sink,
      queue: [],
      queued: 0,
      resync: false,
      flow,
      unacked: 0,
      paused: false,
      exitSent: exited,
    });
    return Buffer.from(this.ring.snapshot()).toString("base64");
  }

  /** True when the connection was attached. */
  release(sink: TerminalSink): boolean {
    return this.clients.delete(sink);
  }

  /**
   * The client has drawn `bytes` more of the output; true when that frees a paused client, so a
   * flush is due. An ack from a client that is gone or did not ask for flow control is ignored.
   */
  ack(sink: TerminalSink, bytes: number): boolean {
    const client = this.clients.get(sink);
    return client?.flow ? acknowledge(client, bytes) : false;
  }

  /** The PTY wrote `chunk`: it goes into the ring and into each client's queue. */
  write(chunk: Uint8Array): void {
    this.ring.append(chunk);
    const copy = chunk.slice();
    for (const client of this.clients.values()) {
      if (client.resync) continue;
      if (enqueue(client, copy, () => client.sink.backlog())) {
        client.sink.send({ type: "terminal.resync", terminalId: this.terminalId });
      }
    }
  }

  /**
   * Sends what each client can take, in frames of at most 16 KB, and the end of the process
   * (`exitCode`, when it has one) once a client has its output; true when something is held.
   */
  flush(exitCode: number | null): boolean {
    let held = false;
    for (const client of this.clients.values()) {
      while (canSend(client, () => client.sink.backlog())) {
        const batch = takeBatch(client);
        client.sink.send({
          type: "terminal.data",
          terminalId: this.terminalId,
          data: Buffer.from(batch).toString("base64"),
        });
        recordSent(client, batch.length);
      }
      if (holdsOutput(client)) {
        // A paused client is not looked at again until its ack arrives.
        if (!client.paused) held = true;
      } else if (exitCode !== null && !client.exitSent) {
        client.exitSent = true;
        client.sink.send({ type: "terminal.exited", terminalId: this.terminalId, exitCode });
      }
    }
    return held;
  }
}
