/**
 * The clone address rules of the projects domain (#1601): which addresses may be cloned and the
 * folder name one implies. Pure: no filesystem, no process.
 */
import { FlightdeckError } from "../../kernel/index.ts";

export const refuse = (
  code: "bad_request" | "invalid_state",
  reason: string,
  message: string,
  params?: Record<string, string | number>,
) => new FlightdeckError(code, message, reason, params);

const SCHEMES = [/^https:\/\//i, /^ssh:\/\//i, /^[\w.-]+@[\w.-]+:\S/];
export const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The folder name a URL implies: its last path segment without `.git`; null when it has none. */
export function nameOf(url: string): string | null {
  let path = URL.canParse(url) ? new URL(url).pathname : "";
  if (/^[\w.-]+@[\w.-]+:/.test(url)) path = url.slice(url.indexOf(":") + 1);
  const last = path.split("/").reverse().find(Boolean);
  return last ? last.replace(/\.git$/i, "") : null;
}

/** A control character: below the space, or DEL. */
const isControl = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0;
  return code < 32 || code === 127;
};

/** Lets only an https or ssh address through: no option, no local path, no transport helper. */
export function checkUrl(url: string): void {
  if (url.startsWith("-")) {
    throw refuse("bad_request", "clone_url_invalid", "the address cannot start with a dash");
  }
  if (!SCHEMES.some((scheme) => scheme.test(url))) {
    throw refuse("bad_request", "clone_url_scheme", "only https:// and ssh addresses are cloned");
  }
  if (/\s/.test(url) || [...url].some(isControl)) {
    throw refuse(
      "bad_request",
      "clone_url_invalid",
      "the address has spaces or control characters",
    );
  }
}
