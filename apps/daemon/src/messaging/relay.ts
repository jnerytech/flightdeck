/** A queued message as the app carries it to another host (#1609). */
import { type MessageKind, RelayMessage } from "@flightdeck/protocol";
import { parseJsonOr } from "../json-text.ts";

/** The columns of a stored message the relay reads. */
interface RelayRow {
  id: string;
  to_session: string;
  to_host: string;
  text: string;
  created_at: string;
  kind: MessageKind;
  sender: string | null;
  untrusted: number;
}

/** The message as the app carries it; null when its stored sender is damaged (it cannot be answered). */
export function relayOf(row: RelayRow): RelayMessage | null {
  const from = parseJsonOr(RelayMessage.shape.from.nullable(), String(row.sender), null);
  if (from === null) return null;
  return {
    id: row.id,
    from,
    toSession: row.to_session,
    toHost: row.to_host,
    text: row.text,
    createdAt: row.created_at,
    untrusted: row.untrusted === 1,
    kind: row.kind,
  };
}
