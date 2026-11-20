/** The files `build:daemon` and `release:npm` leave in `dist/` for a release. */

/** `build:daemon` outputs. */
export const DAEMONS = [
  "dist/flightdeckd-windows-x64.exe",
  "dist/flightdeckd-linux-x64",
  "dist/flightdeckd-linux-arm64",
];

/** What `npm pack` leaves in `dist/` (#3541). */
export const npmTarball = (version: string) => `dist/flightdeckd-${version}.tgz`;
