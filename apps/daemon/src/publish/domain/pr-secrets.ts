import type { SecretScanner } from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";

/**
 * What goes public is checked: each field refused by its own reason, naming the pattern found and
 * never the secret.
 */
export function assertNoSecretInPr(
  scanner: Pick<SecretScanner, "scan"> | undefined,
  title: string,
  body: string,
): void {
  for (const [field, text, reason] of [
    ["description", body, "pr_secret"],
    ["title", title, "pr_title_secret"],
  ] as const) {
    const found = scanner?.scan(text) ?? [];
    if (found.length > 0) {
      throw new FlightdeckError(
        "bad_request",
        `the ${field} looks like it has a secret (${found.join(", ")}): take it out before opening the PR`,
        reason,
        { found: found.join(", ") },
      );
    }
  }
}

/**
 * `text` with every address in it cut to its scheme, host and path: no user or password (up to the
 * last `@` before the path, since a password may hold one), no query and no fragment, where a
 * token may ride. Git quotes the address in its messages, and `changes.get` shows the push address.
 */
export function withoutCredentials(text: string): string {
  // A scheme starts where its run of scheme characters starts (the lookbehind), so each run is
  // read once; the digits and signs before its first letter are kept as they were.
  return text.replace(
    /(?<![a-z0-9+.-])([0-9+.-]*[a-z][a-z0-9+.-]*:\/\/)([^\s'"]*)/gi,
    (_, scheme: string, rest: string) => {
      const address = rest.replace(/^[^/]*@/, "");
      const cut = address.search(/[?#]/);
      return scheme + (cut === -1 ? address : address.slice(0, cut));
    },
  );
}
