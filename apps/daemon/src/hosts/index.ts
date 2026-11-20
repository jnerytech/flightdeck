/**
 * The hosts domain's public entry on the daemon (#1589): what a host says about itself from the
 * command line. Another domain imports from here, never a file inside.
 */
export { type HostCliArgs, runHostCli } from "./cli.ts";
