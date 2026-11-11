/** The key of a session across hosts: `hostId/sessionId`. */
export const sessionKey = (hostId: string, sessionId: string) => `${hostId}/${sessionId}`;
