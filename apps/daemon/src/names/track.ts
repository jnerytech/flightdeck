/**
 * Phase 21, standard session names: names every session of this host when it shows up, whichever
 * way it was born (the app, a terminal, a card, a team, a plain claude seen by the hooks).
 */
import type { ExternalSession, SessionSummary } from "@flightdeck/protocol";
import { projectName } from "./format.ts";
import type { Names } from "./names.ts";

export interface TrackOptions {
  names: Names;
  manager: {
    list(): SessionSummary[];
    get(sessionId: string): SessionSummary;
    watchSummaries(listener: (envelope: { event: { type: string; sessionId?: string } }) => void): {
      unwatch: () => void;
    };
  };
  external: {
    list(): ExternalSession[];
    onChange(listener: (session: ExternalSession) => void): () => void;
  };
  /** The key or the path that names the project a folder belongs to. */
  projectOf: (cwd: string) => string;
  /** The card a managed session works for, if any. */
  cardOf: (sessionId: string) => string | null;
  /** The persona a session already has (phase 20's extension point); null when none. */
  personaOf?: ((sessionId: string) => string | null) | undefined;
}

/** Starts naming; returns the function that stops it. */
export function trackNames(opts: TrackOptions): () => void {
  const { names } = opts;

  const managed = (session: SessionSummary): void => {
    if (names.get(session.id)) return;
    names.assign(session.id, {
      project: projectName(opts.projectOf(session.cwd)),
      persona: opts.personaOf?.(session.id) ?? null,
      cardId: opts.cardOf(session.id),
    });
  };

  const terminal = (session: ExternalSession): void => {
    const id = session.claudeSessionId;
    if (names.get(id)) return;
    names.assign(id, {
      project: projectName(session.cwd ? opts.projectOf(session.cwd) : (session.projectKey ?? "")),
      persona: opts.personaOf?.(id) ?? null,
    });
  };

  // The ones that were here before, oldest first, so the numbers follow the order they were born.
  const before = [
    ...opts.manager.list().map((s) => ({ at: s.createdAt, key: s.id, name: () => managed(s) })),
    ...opts.external
      .list()
      .map((s) => ({ at: s.startedAt, key: s.claudeSessionId, name: () => terminal(s) })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  for (const item of before) item.name();

  const offs = [
    opts.manager.watchSummaries(({ event }) => {
      if (event.type === "session.summary" && event.sessionId) {
        managed(opts.manager.get(event.sessionId));
      }
    }).unwatch,
    opts.external.onChange(terminal),
  ];
  return () => {
    for (const off of offs.splice(0)) off();
  };
}
