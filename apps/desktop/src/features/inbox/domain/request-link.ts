const PREFIX = "flightdeck://request?";

/** `flightdeck://` link to an open request (phase 8): a notification click opens the app on it. */
export function requestLink(hostId: string, requestId: string): string {
  return `${PREFIX}${new URLSearchParams({ host: hostId, request: requestId })}`;
}

/** The request a link points to; `null` for any other link (pairing links, for one). */
export function parseRequestLink(url: string): { hostId: string; requestId: string } | null {
  if (!url.startsWith(PREFIX)) return null;
  const params = new URLSearchParams(url.slice(PREFIX.length));
  const hostId = params.get("host");
  const requestId = params.get("request");
  return hostId && requestId ? { hostId, requestId } : null;
}
