/**
 * The teams domain's public entry (#1589): the `flightdeckd team` command (#3455). Another domain
 * imports from here, never a file inside.
 */
export type { TeamCliArgs } from "./domain/team-cli-view.ts";
export { runTeamCli } from "./team-cli.ts";
