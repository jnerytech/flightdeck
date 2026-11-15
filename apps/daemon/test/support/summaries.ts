import type { EventEnvelope, SessionEventOf } from "@flightdeck/protocol";

type Summary = SessionEventOf<"session.summary">;

/** The `session.summary` events of a list of envelopes. */
export const summaries = (list: EventEnvelope[]) =>
  list.flatMap((e) => (e.event.type === "session.summary" ? [e.event as Summary] : []));
