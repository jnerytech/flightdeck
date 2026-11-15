/**
 * What the messaging layer knows of the sessions of other hosts, the frames the app watches, and the
 * small rules that need no I/O: the pair key, the day and outbox windows, the flightdeck sender.
 */
import type { MessageInfo, MessagingSession, RelayMessage } from "@flightdeck/protocol";

/** The frames the app watches. */
export type MessagingFrame =
  | { type: "messages.updated"; message: MessageInfo }
  | { type: "messages.relay"; message: RelayMessage }
  | {
      type: "messaging.alert";
      kind: "loop";
      from: string;
      to: string;
      message: string;
      at: string;
    };

/** Sessions of another host, as the app last told this daemon. */
export interface PeerSession {
  id: string;
  name: string | null;
  alias?: string | null;
  aliases?: string[];
  persona: string | null;
  projectKey: string | null;
  teamId: string | null;
  state: MessagingSession["state"];
  kind: MessagingSession["kind"];
  receives: boolean;
  reason: string | null;
}

/** A session of this host as the app hands it to the other daemons: the aliases always come. */
export type ListedSession = PeerSession & { alias: string | null; aliases: string[] };

export const DAY_MS = 24 * 3_600_000;
export const OUTBOX_MS = 24 * 3_600_000;
export const FLIGHTDECK = "flightdeck";

export type Params = Record<string, string | number>;

/** An address that does not lead to a session: the words for the logs, and the reason for the app. */
export interface Missing {
  error: string;
  reason: string;
  params: Params;
}

/** The key of a pair, the same from both sides. */
export const pairKey = (a: string, b: string): string =>
  [a, b].sort((a, b) => (a < b ? -1 : Number(a > b))).join("|");
