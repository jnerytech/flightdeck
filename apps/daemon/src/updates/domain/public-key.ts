/// <reference path="../../text-modules.d.ts" />
/**
 * The project's minisign public key (release/flightdeck.pub), embedded by `bun build --compile`.
 * `build:daemon` refuses to build when the file is not a valid key.
 */

import key from "../../../../../release/flightdeck.pub" with { type: "text" };

export const PUBLIC_KEY: string = key;

/**
 * The key `daemon.update.apply` checks with. A daemon running from source (smokes, tests) may
 * take a test key from FLIGHTDECK_TEST_PUBLIC_KEY; a compiled flightdeckd never does. The caller
 * passes the environment and whether the daemon runs compiled (issue #1601: the rule stays pure).
 */
export function updatePublicKey(
  env: Record<string, string | undefined>,
  compiled: boolean,
): string {
  return !compiled && env.FLIGHTDECK_TEST_PUBLIC_KEY ? env.FLIGHTDECK_TEST_PUBLIC_KEY : PUBLIC_KEY;
}
