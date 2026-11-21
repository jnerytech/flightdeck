/**
 * Issue #3735: what `flightdeckd external` prints, as pure rules over the daemon's answers. The command asks
 * the daemon, this words the result. The terminal-control scrub is the runner's (`said`, `json`).
 */
import type { ExternalSession } from "@flightdeck/protocol";

/**
 * The small row a script reads. Not the transcript path, the launch id, the last prompt or the plan text: those
 * belong to a person's terminal, and the app's own screens are where they are read.
 */
export const externalRow = (session: ExternalSession) => ({
  claudeSessionId: session.claudeSessionId,
  name: session.meta?.name ?? null,
  cwd: session.cwd,
  status: session.status,
  statusReason: session.statusReason,
  controllable: session.controllable,
  source: session.source,
  projectKey: session.projectKey,
  permissionMode: session.permissionMode ?? null,
  waiting: session.waiting ?? null,
  startedAt: session.startedAt,
  lastEventAt: session.lastEventAt,
  endedAt: session.endedAt,
});

/** One line of a session, for the stream; the list indents it under its count. */
export const externalLine = (session: ExternalSession): string => {
  const status =
    session.statusReason === null ? session.status : `${session.status} (${session.statusReason})`;
  const takes = session.controllable ? "controllable" : "not controllable";
  const where = session.cwd ?? "no folder";
  const name = session.meta?.name ?? "(unnamed)";
  return `${session.claudeSessionId} ${name}, ${status}, ${takes}, ${where}, last event ${session.lastEventAt}`;
};

export const externalLines = (sessions: ExternalSession[]): string[] =>
  sessions.length === 0
    ? ["no external sessions"]
    : [
        `${sessions.length} external ${sessions.length === 1 ? "session" : "sessions"}`,
        ...sessions.map((session) => `  ${externalLine(session)}`),
      ];

/** The JSON a script reads: which session got the text. A refusal never reaches here. */
export const sentJson = (session: string) => ({ session, delivered: true });

export const sentLine = (session: string): string => `sent to ${session}`;

export const UNSURE =
  "; the text may or may not have gone into the session: look at the session before you send it again";
