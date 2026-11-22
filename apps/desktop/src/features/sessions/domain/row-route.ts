import type { Route } from "../../../lib/router.ts";
import { type HubRow, isOver } from "./hub.ts";

/** A background session whose host did not report its Claude session: no screen to open (#4171). */
export const hasNoScreen = (row: HubRow): boolean =>
  row.origin === "background" && !row.sessionId && !row.claudeSessionId;

/** From the Sessões screen: the conversation, the live terminal view or the reader. */
export function rowRoute(row: HubRow): Route {
  const id = row.claudeSessionId as string;
  if (row.sessionId) return { name: "session", host: row.hostId, id: row.sessionId };
  if (row.origin === "terminal" && !isOver(row.state)) {
    return { name: "external", host: row.hostId, claudeSessionId: id };
  }
  // A background session: its screen when the host knows its Claude session, else the hub.
  if (row.origin === "background") {
    return id ? { name: "external", host: row.hostId, claudeSessionId: id } : { name: "hub" };
  }
  return { name: "reader", target: { hostId: row.hostId, claudeSessionId: id } };
}
