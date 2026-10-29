/// <reference path="../text-modules.d.ts" />
/**
 * The project's minisign public key (release/flightdeck.pub), embedded by `bun build --compile`.
 * `build:daemon` refuses to build when the file is not a valid key.
 */
import key from "../../../../release/flightdeck.pub" with { type: "text" };

export const PUBLIC_KEY: string = key;
