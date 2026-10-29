/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The demo's hosts, already paired (JSON; scripts/demo.ts sets it). */
  readonly VITE_DEMO_HOSTS?: string;
}
