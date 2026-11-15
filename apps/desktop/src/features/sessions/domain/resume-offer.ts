import type { InterruptedSession } from "@flightdeck/protocol";
import { basename } from "@/shared/lib/index.ts";

/** What resume sends to a resumed session: the original request is never sent again. */
export const CONTINUATION = "Continue where you left off.";

/** One interruption of a session: the same session interrupted again by another restart is a new one. */
export const offerKey = (session: InterruptedSession): string =>
  `${session.sessionId}@${session.interruptedAt}`;

/** What the person has not answered yet. */
export function unanswered(
  sessions: InterruptedSession[],
  handled: string[] | undefined,
): InterruptedSession[] {
  const seen = new Set(handled ?? []);
  return sessions.filter((session) => !seen.has(offerKey(session)));
}

/** The sessions by project folder, in the order they came. */
export function byProject(
  sessions: InterruptedSession[],
): Array<{ project: string; sessions: InterruptedSession[] }> {
  const groups = new Map<string, InterruptedSession[]>();
  for (const session of sessions) {
    const project = basename(session.cwd);
    groups.set(project, [...(groups.get(project) ?? []), session]);
  }
  return [...groups].map(([project, list]) => ({ project, sessions: list }));
}
