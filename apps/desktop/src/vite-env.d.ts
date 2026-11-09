/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The demo's hosts, already paired (JSON; scripts/demo.ts sets it). */
  readonly VITE_DEMO_HOSTS?: string;
  /** Issue #1444: the Google Cloud OAuth client of the app. Unset until the maintainer makes one (#57). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** The secret Google issues with a desktop client; it is not confidential, and optional here. */
  readonly VITE_GOOGLE_CLIENT_SECRET?: string;
}
