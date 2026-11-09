import type { GoogleConfig } from "./google-oauth.ts";

/** The build's Google OAuth client, or null while the maintainer has not made one (#57). */
export function googleConfig(
  _env: Record<string, string | undefined> = import.meta.env,
): GoogleConfig | null {
  return { clientId: "" };
}
