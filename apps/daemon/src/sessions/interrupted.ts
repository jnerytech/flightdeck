import type { InterruptedSession } from "@flightdeck/protocol";
import type { EventStore } from "../store/index.ts";

/** The reason a restart gives the sessions it interrupts: a code (the app words it), not a sentence. */
export const RESTART_REASON = "daemon_restarted";

/** The request cut at 200 characters, never in the middle of an emoji. */
function cutRequest(text: string): string {
  const cut = text.slice(0, 200);
  const last = cut.codePointAt(cut.length - 1) ?? 0;
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
/** What daemons before the code wrote: rows left by them are still offered. */
const OLD_RESTART_REASON = "daemon reiniciado";
const OFFER_WINDOW_MS = 24 * 3_600_000;

/** The sessions a daemon restart interrupted in the last 24 hours and nobody resumed since. */
export function interruptedSessions(
  store: EventStore,
  options: { now?: number; withinMs?: number } = {},
): InterruptedSession[] {
  const now = options.now ?? Date.now();
  const within = options.withinMs ?? OFFER_WINDOW_MS;
  const found: InterruptedSession[] = [];
  // In the order they were started (a team's coordinator comes before its workers); only what is
  // still `error`: a resumed or ended session left the offer.
  for (const session of store.listSessionsByStatus("error")) {
    // Without a Claude session id there is nothing to resume.
    if (!session.claudeSessionId) continue;
    const events = store.eventsSince(session.id);
    const marked = [...events]
      .reverse()
      .find((e) => e.event.type === "session.status" && e.event.status === "error");
    const reason = marked?.event.type === "session.status" ? marked.event.reason : undefined;
    if (!marked || (reason !== RESTART_REASON && reason !== OLD_RESTART_REASON)) continue;
    const interruptedAt = Date.parse(marked.ts);
    if (!Number.isFinite(interruptedAt) || now - interruptedAt > within) continue;
    const asked = [...events].reverse().find((e) => e.event.type === "message.user");
    found.push({
      sessionId: session.id,
      name: session.name,
      cwd: session.cwd,
      persona: session.persona?.name ?? null,
      interruptedAt: marked.ts,
      ranMs: Math.max(0, interruptedAt - Date.parse(session.createdAt)),
      lastRequest: asked?.event.type === "message.user" ? cutRequest(asked.event.text) : null,
    });
  }
  return found;
}
