import type { AppStore } from "../lib/app-store.ts";

/**
 * Phase 30: the short summary of a session (what was asked and done, the files, the cost and the
 * open question), built by the host from the transcript.
 */
export function RecapPanel(_props: {
  store: AppStore;
  hostId: string;
  claudeSessionId: string;
  /** The pending request, when the session waits for you. */
  question?: string;
  /** Changes when the session moves on, so the summary is read again. */
  stamp?: string;
}) {
  return null;
}
