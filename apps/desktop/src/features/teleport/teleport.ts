/**
 * Issue #100, slice 3a: the app moves an idle session from one host to another. The relay itself
 * (package, summary, chunks, import, clean-up) is `@flightdeck/protocol`'s `teleportSession` since #3704,
 * shared with `flightdeckd session teleport`; this file gives it the app's refusal and its host channels.
 */
import {
  teleportSession as relayTeleport,
  type TeleportRun as SharedTeleportRun,
  type TeleportOutcome,
  type TeleportRequest,
  type TeleportSummary,
} from "@flightdeck/protocol";
import { type HostConnection, RequestError } from "../hosts/index.ts";
import { isLocalUrl } from "../terminal/index.ts";

export {
  plainText,
  type TeleportOutcome,
  type TeleportRequest,
  type TeleportSummary,
  teleportSummary,
} from "@flightdeck/protocol";

/** What a move needs from the app: the shared relay's run, with the refusal the app shows given by this file. */
export type TeleportRun = Omit<SharedTeleportRun, "refuse">;

/** What the app's dialog hands the store for a move: the target, the repository, the person's say. */
export interface TeleportRunArgs {
  target: string;
  repo: string;
  confirm(summary: TeleportSummary): Promise<boolean>;
  onProgress(sent: number, total: number): void;
  signal: AbortSignal;
}

/** What the source sent does not hold together: refused with a reason the person can read. */
const refused = (reason: "teleport_corrupt" | "teleport_incomplete") =>
  new RequestError("bad_request", reason.replaceAll("_", " "), reason);

export const teleportSession = (run: TeleportRun): Promise<TeleportOutcome> =>
  relayTeleport({ ...run, refuse: refused });

/** A host the app reaches over plain `ws://` and not on this machine: nothing encrypts its traffic. */
export function isPlainRemote(url: string): boolean {
  try {
    return new URL(url).protocol === "ws:" && !isLocalUrl(url);
  } catch {
    return false;
  }
}

/**
 * The store's session moves (#1596: a slice of the store): each host's command channel for a
 * teleport's relay, and the move itself from one host to the target the dialog picked.
 */
export class SessionMover {
  constructor(private readonly connection: (hostId: string) => HostConnection | undefined) {}

  /** A host's command channel for a teleport's relay (issue #100): refusals come back as errors. */
  request(hostId: string): TeleportRequest {
    // Straight to the connection: a host's teleport answer is checked by the relay, and never
    // reaches the board's card or run state on the way.
    return ((type, payload) => {
      const conn = this.connection(hostId);
      if (!conn) return Promise.reject(new RequestError("offline", "unknown host"));
      // The relay sends only the teleport commands and `session.meta.set`; its map is narrower than `CommandPayload`.
      return conn.request(type, payload as never);
    }) as TeleportRequest;
  }

  /** Moves a session from `sourceHost` to the target the dialog picked (issue #100). */
  move(sourceHost: string, sessionId: string, args: TeleportRunArgs): Promise<TeleportOutcome> {
    return teleportSession({
      source: this.request(sourceHost),
      target: this.request(args.target),
      sessionId,
      repo: args.repo,
      confirm: args.confirm,
      onProgress: args.onProgress,
      signal: args.signal,
    });
  }
}
