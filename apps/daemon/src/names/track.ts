/**
 * Phase 21, standard session names: names every session of this host when it shows up, whichever
 * way it was born (the app, a terminal, a card, a team, a plain claude seen by the hooks).
 */
import type { ExternalSession, SessionSummary } from "@flightdeck/protocol";
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
export function trackNames(_opts: TrackOptions): () => void {
  return () => {};
}
