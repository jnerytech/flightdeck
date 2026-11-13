import type { InterruptedSession } from "@flightdeck/protocol";
import { z } from "zod";
import { basename, readStored } from "@/shared/lib/index.ts";

/** What resume sends to a resumed session: the original request is never sent again. */
export const CONTINUATION = "Continue where you left off.";

const HANDLED_KEY = "flightdeck.resumeHandled";
const AUTO_KEY = "flightdeck.resumeAuto";

type Storage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const Keys = z.array(z.string());

/** What is kept by host: a host whose value is not a list of text is dropped, the others stay. */
const Handled = z.record(z.string(), z.unknown()).transform((all) =>
  Object.fromEntries(
    Object.entries(all).flatMap(([host, keys]) => {
      const list = Keys.safeParse(keys);
      return list.success ? [[host, list.data]] : [];
    }),
  ),
);

/** The hosts set to resume by themselves: only a stored `true` counts. */
const Auto = z
  .record(z.string(), z.unknown())
  .transform((all) => Object.fromEntries(Object.entries(all).filter(([, on]) => on === true)));

/** One interruption of a session: the same session interrupted again by another restart is a new one. */
export const offerKey = (session: InterruptedSession): string =>
  `${session.sessionId}@${session.interruptedAt}`;

/** The interruptions the person has already answered ("Not now" or "Dismiss all", or resumed), by host. */
export function loadHandled(storage: Pick<Storage, "getItem">): Record<string, string[]> {
  return readStored(storage, HANDLED_KEY, Handled, {});
}

export function markHandled(storage: Storage, hostId: string, keys: string[]): void {
  const all = loadHandled(storage);
  const merged = new Set([...(all[hostId] ?? []), ...keys]);
  // A day of offers is all that can come back: older keys only grow the file.
  all[hostId] = [...merged].slice(-200);
  storage.setItem(HANDLED_KEY, JSON.stringify(all));
}

/** What the person has not answered yet. */
export function unanswered(
  sessions: InterruptedSession[],
  handled: string[] | undefined,
): InterruptedSession[] {
  const seen = new Set(handled ?? []);
  return sessions.filter((session) => !seen.has(offerKey(session)));
}

export function loadAutoResume(storage: Pick<Storage, "getItem">, hostId: string): boolean {
  return readStored(storage, AUTO_KEY, Auto, {})[hostId] === true;
}

export function saveAutoResume(storage: Storage, hostId: string, on: boolean): void {
  const all: Record<string, unknown> = readStored(storage, AUTO_KEY, Auto, {});
  if (on) all[hostId] = true;
  else delete all[hostId];
  storage.setItem(AUTO_KEY, JSON.stringify(all));
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
