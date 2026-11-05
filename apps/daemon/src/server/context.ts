/**
 * Issue #248: what every handler shares, built once by `startServer`: its options, the session
 * manager, and the feature gates. The view helpers several domains use move here with the first
 * domain that needs them.
 */
import type { ServerOptions } from "../server.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { type GatedOption, need } from "./gates.ts";

export interface ServerContext {
  opts: ServerOptions;
  manager: SessionManager;
  /** The service behind a gated option, or the `feature_off` refusal. */
  need<K extends GatedOption>(key: K): NonNullable<ServerOptions[K]>;
}

export function serverContext(opts: ServerOptions): ServerContext {
  return {
    opts,
    manager: opts.manager,
    need: (key) => need(opts, key),
  };
}
