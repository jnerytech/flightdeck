import { type PairingError, parsePairingLink } from "@flightdeck/protocol";

/** What stands for a pairing link's token on screen, as the Token field shows its own. */
export const TOKEN_MASK = "••••";

/** A real token never has this character, so a token that has it is the shown mask, edited or not. */
const DOT = "•";

/** What follows `token=` in text that may not read as a link: the key as typed or as `%74oken`. */
const TOKEN_PARAM = /([?&](?:token|%74oken)=)[^&\s]*/gi;

/**
 * The link as it is shown: its token as dots. A link that reads is rebuilt from what the parser read,
 * so nothing of the typed text stays (an encoded key, a repeated token, a `#` or a space inside it).
 * Text that does not read yet (a bad port, say) has what follows `token=` replaced in place. A screen
 * share or a screenshot of the form then shows no token; the real one lives in the form's draft (the
 * Token field, a password input).
 */
export function maskPairingLink(link: string): string {
  const parsed = parsePairingLink(link);
  const where = parsed.ok ? /^ws:\/\/(.+):(\d+)\/v1\/ws$/.exec(parsed.value.url) : null;
  if (!parsed.ok || !where) return link.replace(TOKEN_PARAM, `$1${TOKEN_MASK}`);
  const name = encodeURIComponent(parsed.value.name);
  return `flightdeck://${where[1]}:${where[2]}?name=${name}&token=${TOKEN_MASK}`;
}

/** The token in text that may not read as a link yet: the first one, decoded; null when there is none. */
export function tokenInText(text: string): string | null {
  const found = /[?&](?:token|%74oken)=([^&\s]*)/i.exec(text)?.[1];
  if (!found) return null;
  try {
    return decodeURIComponent(found);
  } catch {
    return found;
  }
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
  // A token held from text that did not read has no address yet: it goes with the first host read.
  const sameHost =
    draft.address === "" || (next.address === draft.address && next.port === draft.port);
  return sameHost && draft.token !== "" ? draft.token : null;
}

/** Why a link edited in the form is refused: the parser's reasons, or the token not going to another host. */
export type LinkProblem = PairingError | "elsewhere";

/** What an edit of the link field does to the form. */
export interface LinkEdit {
  /** What the field shows next. */
  shown: string;
  /** What is wrong with the link, or null. */
  problem: LinkProblem | null;
  /** The link read: the fields it fills, the token being the real one. */
  fields: { name: string; address: string; port: string; token: string } | null;
  /** A token held from text that did not read yet, or cleared (an empty string), or left alone (null). */
  held: string | null;
}

/**
 * What an edit of the link field means. A link that is typed (one character at a time) is shown as
 * typed, so the token being typed is not rewritten under the person; one that arrives at once (a
 * paste, a drop, an autofill) is shown masked, and so is any link when the field loses the focus. The
 * real token always goes to the draft, the one shown with dots is never taken for it.
 */
export function readLinkEdit(
  value: string,
  previous: string,
  draft: { address: string; port: string; token: string },
  inserted = false,
): LinkEdit {
  const bulk = inserted || Math.abs(value.length - previous.length) > 1;
  const parsed = parsePairingLink(value);
  if (!value) return { shown: value, problem: null, fields: null, held: null };
  if (!parsed.ok) {
    const found = tokenInText(value);
    const held = parsed.error === "token" ? "" : found && !found.includes(DOT) ? found : null;
    return {
      shown: bulk ? maskPairingLink(value) : value,
      problem: parsed.error,
      fields: null,
      held,
    };
  }
  const where = /^ws:\/\/(.+):(\d+)\/v1\/ws$/.exec(parsed.value.url);
  const next = { address: (where?.[1] ?? "").replace(/^\[|\]$/g, ""), port: where?.[2] ?? "" };
  const token = keptToken(parsed.value.token, next, draft);
  if (token === null) {
    const problem = draft.token === "" ? "token" : "elsewhere";
    return { shown: value, problem, fields: null, held: null };
  }
  const shown = bulk ? maskPairingLink(value) : value;
  return { shown, problem: null, fields: { name: parsed.value.name, ...next, token }, held: null };
}
