/** What stands for a pairing link's token on screen, as the Token field shows its own. */
export const TOKEN_MASK = "••••";

/**
 * The link as it is shown once it is read: its `token=` value as dots, the rest as it was. A screen
 * share or a screenshot of the form then shows no token. The real one lives in the form's draft
 * (the Token field, a password input).
 */
export function maskPairingLink(link: string): string {
  return link.replace(/([?&]token=)[^&#\s]*/i, `$1${TOKEN_MASK}`);
}

/** Which token a link edited in the form carries. */
export function keptToken(
  token: string,
  next: { address: string; port: string },
  draft: { address: string; port: string; token: string },
): string | null {
  return token;
}
