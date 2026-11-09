import type { GoogleConfig } from "./google-oauth.ts";

/** The build's Google OAuth client, or null while the maintainer has not made one (#57). */
export function googleConfig(
  env: Record<string, string | undefined> = import.meta.env,
): GoogleConfig | null {
  const clientId = env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) return null;
  const clientSecret = env.VITE_GOOGLE_CLIENT_SECRET?.trim();
  return clientSecret ? { clientId, clientSecret } : { clientId };
}
