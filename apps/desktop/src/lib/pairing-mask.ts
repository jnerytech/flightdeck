import { parsePairingLink } from "@flightdeck/protocol";

/** What stands for a pairing link's token on screen, as the Token field shows its own. */
export const TOKEN_MASK = "••••";

/** A real token never has this character, so a token that has it is the shown mask, edited or not. */
const DOT = "•";

/**
 * The link as it is shown once it is read: rebuilt from what the parser read, with the token as dots.
 * Nothing of the typed text stays (an encoded key, a repeated token, a `#` inside it), so a screen
 * share or a screenshot of the form shows no token. The real one lives in the form's draft (the Token
 * field, a password input). Text that is not a readable link is returned as it is.
 */
export function maskPairingLink(link: string): string {
  const parsed = parsePairingLink(link);
  if (!parsed.ok) return link;
  const where = /^ws:\/\/(.+):(\d+)\/v1\/ws$/.exec(parsed.value.url);
  if (!where) return link;
  const name = encodeURIComponent(parsed.value.name);
  return `flightdeck://${where[1]}:${where[2]}?name=${name}&token=${TOKEN_MASK}`;
}

/**
 * The token a link edited in the form carries. A token with dots is the shown mask: the real one is
 * kept, but only for the address and port it was read with, so editing the host in the dotted link
 * never sends one host's token to another. `null` when the link has no token to use.
 */
export function keptToken(
  token: string,
  next: { address: string; port: string },
  draft: { address: string; port: string; token: string },
): string | null {
  if (!token.includes(DOT)) return token;
  const sameHost = next.address === draft.address && next.port === draft.port;
  return sameHost && draft.token !== "" ? draft.token : null;
}
