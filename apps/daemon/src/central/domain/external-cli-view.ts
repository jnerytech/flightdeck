/**
 * Issue #3735: what `flightdeckd external` prints, as pure rules over the daemon's answers.
 */
import type { ExternalSession } from "@flightdeck/protocol";

/** The small row a script reads: no transcript, launch or prompt of a person's terminal. */
export const externalRow = (_session: ExternalSession): Record<string, unknown> => ({});

/** One line of a session, for the list and for the stream. */
export const externalLine = (_session: ExternalSession): string => "";

export const externalLines = (_sessions: ExternalSession[]): string[] => [];

export const sentJson = (_session: string) => ({ session: "", delivered: false });

export const sentLine = (_session: string): string => "";

export const UNSURE =
  "; the text may or may not have gone into the session: look at the session before you send it again";
