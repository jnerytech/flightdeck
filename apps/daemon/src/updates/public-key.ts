/// <reference path="../text-modules.d.ts" />
/**
 * The project's minisign public key (release/flightdeck.pub), embedded by `bun build --compile`.
 * `build:daemon` refuses to build when the file is not a valid key.
 */

import key from "../../../../release/flightdeck.pub" with { type: "text" };
import { RUNNING_COMPILED } from "../config.ts";

export const PUBLIC_KEY: string = key;

/**
 * The key `daemon.update.apply` checks with. A daemon running from source (smokes, tests) may
 * take a test key from FLIGHTDECK_TEST_PUBLIC_KEY; a compiled flightdeckd never does.
 */
export function updatePublicKey(
  env: Record<string, string | undefined> = process.env,
  compiled = RUNNING_COMPILED,
): string {
  return !compiled && env.FLIGHTDECK_TEST_PUBLIC_KEY ? env.FLIGHTDECK_TEST_PUBLIC_KEY : PUBLIC_KEY;
}
