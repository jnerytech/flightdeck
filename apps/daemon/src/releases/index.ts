/**
 * The releases domain's public entry (#1589): the app's releases as `flightdeckd releases list` reads them. Other
 * domains import only from here.
 */
export type { ReleasesCliArgs } from "./domain/releases-cli-view.ts";
export { runReleasesCli } from "./releases-cli.ts";
