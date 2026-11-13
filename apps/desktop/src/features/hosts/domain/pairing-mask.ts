import { type PairingError, parsePairingLink } from "@flightdeck/protocol";

/** What stands for a pairing link's token on screen, as the Token field shows its own. */
export const TOKEN_MASK = "••••";

/** A real token never has this character, so a token that has it is the shown mask, edited or not. */
const DOT = "•";

/** The value of every parameter but `name`, in text that may not read as a link: the key as typed or encoded. */
const SECRET_VALUES = /([?&#](?!name=)[^=&\s#?]*=)[^&]*/gi;

/** The `host:port` a pairing link was read with. */
const WHERE = /^ws:\/\/(.+):(\d+)\/v1\/ws$/;

/**
 * The link as it is shown: its token as dots. A link that reads is rebuilt from what the parser read,
 * so nothing of the typed text stays (an encoded key, a repeated token, a `#` or a space inside it).
 * Text that does not read yet (a bad port, say) has the value of every parameter but the name replaced
 * in place, whatever the key's spelling. A screen share or a screenshot of the form then shows no
 * token; the real one lives in the form's draft (the Token field, a password input).
 */
export function maskPairingLink(link: string): string {
  const parsed = parsePairingLink(link);
  const where = parsed.ok ? WHERE.exec(parsed.value.url) : null;
  if (!parsed.ok || !where) return link.replace(SECRET_VALUES, `$1${TOKEN_MASK}`);
  const name = encodeURIComponent(parsed.value.name);
  return `flightdeck://${where[1]}:${where[2]}?name=${name}&token=${TOKEN_MASK}`;
}

/**
 * The link field as it is left (it loses the focus, or the form is submitted): a link is masked as a
 * link; anything else (even "f" or "flight") is a token typed by hand, all of it secret.
 */
export function maskOnLeave(text: string): string {
  return !text.trim() || text.includes("://") ? maskPairingLink(text) : TOKEN_MASK;
}

/** Text pasted into the link field: a bare token (no `://`) is all secret, anything else is masked as a link. */
function maskPasted(text: string): string {
  return /:\/\//.test(text) ? maskPairingLink(text) : TOKEN_MASK;
}

/** The token in text that may not read as a link yet, as the parser would decode it; null when none. */
export function tokenInText(text: string): string | null {
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get("token") || null;
}

/** The host and port a token was read with, and the token. */
export interface BoundToken {
  address: string;
  port: string;
  token: string;
}

/**
 * The token a link edited in the form carries. A token with dots is the shown mask: the token read
 * with this same address and port is kept, so editing the host in the dotted link never sends one
 * host's token to another, and a token typed in the Token field (read with no host) is never taken
 * for it. `null` when there is no token to use.
 */
export function keptToken(
  token: string,
  next: { address: string; port: string },
  bound: BoundToken | null,
): string | null {
  if (!token.includes(DOT)) return token;
  const same = bound?.address === next.address && bound.port === next.port;
  return same ? bound.token : null;
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
  /** The token the form holds from the link, and the host it was read with: kept, set, or dropped. */
  bound: BoundToken | null;
}

/**
 * What an edit of the link field means. A link that is typed (one character at a time) is shown as
 * typed, so the token being typed is not rewritten under the person; one that arrives any other way
 * (a paste, a drop, an autofill, an IME) is shown masked, and so is any link when the field loses the
 * focus. The real token goes to the draft, bound to the host it was read with; the dots are never
 * taken for it, and text that does not read writes no token anywhere.
 */
export function readLinkEdit(
  value: string,
  previous: string,
  bound: BoundToken | null,
  inputType = "",
): LinkEdit {
  // A composition (an IME, a dead key) is typing too: the field is not rewritten under it.
  const typed =
    inputType === "insertText" ||
    inputType === "insertCompositionText" ||
    inputType.startsWith("delete");
  // A typed character grows the value by one at most: more is a paste whatever the event says.
  const bulk =
    (inputType ? !typed : false) ||
    value.length - previous.length > 1 ||
    previous.length - value.length > 1;
  const show = (text: string) => (bulk ? maskPasted(text) : text);
  // An emptied field is a reset: the token it carried goes (the form drops it with the binding).
  if (!value) return { shown: value, problem: null, fields: null, bound: null };
  const parsed = parsePairingLink(value);
  if (!parsed.ok) {
    // A link that was read and now has no token loses it, whatever else is wrong with it.
    const dropped =
      value.trimStart().toLowerCase().startsWith("flightdeck://") && tokenInText(value) === null;
    return {
      shown: show(value),
      problem: parsed.error,
      fields: null,
      bound: dropped ? null : bound,
    };
  }
  const where = WHERE.exec(parsed.value.url);
  const next = { address: (where?.[1] ?? "").replace(/^\[|\]$/g, ""), port: where?.[2] ?? "" };
  const token = keptToken(parsed.value.token, next, bound);
  if (token === null) {
    return { shown: show(value), problem: bound ? "elsewhere" : "token", fields: null, bound };
  }
  const read = { ...next, token };
  return {
    shown: show(value),
    problem: null,
    fields: { name: parsed.value.name, ...read },
    bound: read,
  };
}
