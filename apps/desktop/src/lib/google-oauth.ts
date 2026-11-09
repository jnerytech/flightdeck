import type { Platform } from "../platform/types.ts";
import type { DriveAuth } from "./drive-target.ts";

/** The Google Cloud OAuth client of the app; none until the maintainer makes one (#57). */
export interface GoogleConfig {
  clientId: string;
  /** Google's "desktop" clients come with a secret that is not one; set only when the client has it. */
  clientSecret?: string;
}

export type SignInResult = "signed-in" | "cancelled" | "refused";

export interface GoogleSignIn {
  /** Opens Google's consent page in the browser and waits for the redirect on the loopback. */
  signIn(): Promise<SignInResult>;
  /** Whether a refresh token is held. */
  signedIn(): Promise<boolean>;
  /** Forgets the sign-in: the refresh token leaves the vault. */
  signOut(): Promise<void>;
  /** The access token for Drive calls. */
  auth: DriveAuth;
}

export interface GoogleDeps {
  config: GoogleConfig;
  fetch: typeof fetch;
  vault: Platform["vault"];
  loopback: NonNullable<Platform["oauthLoopback"]>;
  openExternal: (url: string) => Promise<void>;
  now?: () => number;
}

/** The vault id of the refresh token. It has no vault metadata, so no screen lists it and no backup carries it. */
export const REFRESH_TOKEN_ID = "flightdeck-google-drive-refresh";

export function googleSignIn(_deps: GoogleDeps): GoogleSignIn {
  return {
    signIn: async () => "cancelled",
    signedIn: async () => false,
    signOut: async () => {},
    auth: { token: async () => "" },
  };
}
