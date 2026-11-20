/**
 * A `flightdeckd` command that streams (docs/decisions/2026-11-20-cli-streams.md): the daemon acks the
 * request that opens the stream and then pushes frames until the socket closes. It runs until Ctrl-C
 * (`signal`), the daemon goes away (exit 2), a frame cannot be read or the terminal cannot be written to.
 * Each line goes through the token scrub of the runner and the terminal-control scrub of the other commands.
 */
import type { ServerMessage } from "@flightdeck/protocol";
import type { CliResult } from "./cli-view.ts";
import { plain } from "./cli-view.ts";
import type { DaemonClient } from "./client.ts";

export async function streamFrames<T extends ServerMessage["type"]>(opts: {
  daemon: DaemonClient;
  flow: { started(): void; hide(text: string): string };
  signal: AbortSignal;
  write: (line: string) => void;
  /** The request that opens the stream: it resolves when the daemon acks it. */
  open: () => Promise<unknown>;
  /** The frame type, or the types, this stream prints (an `approval.watch` pushes two). */
  type: T | readonly T[];
  /** The line a frame prints. */
  line: (frame: Extract<ServerMessage, { type: T }>) => string;
}): Promise<CliResult> {
  const { daemon, flow, signal, write } = opts;
  const stopped = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
  // A terminal that cannot be written to (a closed pipe) ends the stream, it does not crash the socket handler.
  let unwritable!: (error: unknown) => void;
  const broken = new Promise<never>((_, reject) => {
    unwritable = reject;
  });
  const offs = (Array.isArray(opts.type) ? opts.type : [opts.type]).map((type: T) =>
    daemon.onFrame(type, (frame) => {
      try {
        write(plain(flow.hide(opts.line(frame))));
      } catch (error) {
        unwritable(error);
      }
    }),
  );
  try {
    // Ctrl-C counts from the first moment, also while the daemon has not answered yet.
    await Promise.race([opts.open(), stopped, broken, daemon.unreadable]);
    if (!signal.aborted) {
      flow.started();
      const gone = daemon.closed.then(() => {
        throw new Error("connection closed");
      });
      await Promise.race([stopped, gone, broken, daemon.unreadable]);
    }
    return { code: 0, out: [], err: [] };
  } finally {
    for (const off of offs) off();
  }
}
