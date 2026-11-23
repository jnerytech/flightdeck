import type { GoogleConfig } from "../features/backup/google-oauth.ts";
import type { Platform } from "../platform/types.ts";

/** How the demo's Google answers: the `?google=` of the demo's address. */
export type DemoGoogleMode = "files" | "empty" | "refused" | "revoked" | "down";

/** What the store gets from `google`: the client and the fake Google behind its `fetch`. */
export interface DemoGoogle {
  config: GoogleConfig;
  fetch: typeof fetch;
}

/** The demo's Google for the address's `?google=`; null when the address names none. */
export function demoGoogle(_search: string): DemoGoogle | null {
  return null;
}

/** The platform with the shell's side of the sign-in: a loopback that answers at once and a browser that opens nothing. */
export function withDemoGoogle(platform: Platform, _search: string): Platform {
  return platform;
}
