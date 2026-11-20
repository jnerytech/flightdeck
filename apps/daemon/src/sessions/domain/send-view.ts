/**
 * Issue #3425: what `flightdeckd send` prints. Pure: the command asks the daemon, this words the result.
 */

/** The JSON a script reads: which session got the text, and whether it waits behind a running turn. */
export const sendJson = (session: string, queued: boolean) => ({ session, queued });

export const sendLine = (session: string, queued: boolean): string =>
  `${queued ? "queued for" : "sent to"} ${session}`;
