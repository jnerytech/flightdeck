/** The daemon's version (#1674): a leaf, so a domain reads it without loading the server. */
import pkg from "../../package.json" with { type: "json" };

export const DAEMON_VERSION: string = pkg.version;
