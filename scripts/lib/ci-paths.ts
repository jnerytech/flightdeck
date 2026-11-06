/**
 * Which CI jobs a pull request needs, from the paths it changes (issue #264). Docs or scripts only
 * run the Linux tests and lint; the daemon adds Windows and the smokes; the app, the protocol, the
 * dependencies or the workflow itself run everything; the Tauri shell adds cargo. A push to main,
 * a run by hand, or a diff that cannot be read runs everything.
 */

export interface CiPlan {
  /** The three Windows test shards and the Windows checks. */
  windows: boolean;
  /** The smokes (Linux and Windows). */
  smokes: boolean;
  /** The prints, axe and the e2e journeys. */
  screenshots: boolean;
  /** cargo check and cargo test of the Tauri shell. */
  cargo: boolean;
  /** The e2e journeys (#399): what the screens read, the journeys themselves, their config, the demo. */
  e2e: boolean;
}

export const FULL: CiPlan = {
  windows: true,
  smokes: true,
  screenshots: true,
  cargo: true,
  e2e: true,
};

/** What every job reads: the app, the protocol, the dependencies, the configs and CI itself. */
const EVERYTHING =
  /^(?:apps\/desktop\/|packages\/|\.github\/workflows\/)|^(?:package\.json|bun\.lock|bunfig[^/]*\.toml|tsconfig[^/]*\.json)$/;
const DAEMON = /^apps\/daemon\/|^scripts\/smoke-[^/]+\.ts$/;
const TAURI = /^apps\/desktop\/src-tauri\//;
/** The scripts and their tests: the Windows shards run the tests related to them (#399). */
const SCRIPTS = /^scripts\//;
/**
 * The journeys, their Playwright config and the demo they drive (#399). The demo seed starts the
 * real daemon and uses the scripts' test helpers (fake CLIs, temp folders), so those count too
 * (#410 review); ci-paths.test.ts checks every file the seed imports.
 */
const E2E =
  /^(?:scripts\/e2e\/|scripts\/lib\/(?:e2e|demo)[^/]*\.ts$|scripts\/demo[^/]*\.ts$|playwright[^/]*$|apps\/daemon\/|scripts\/test\/(?![^/]*\.test\.ts$)[^/]+\.ts$)/;

export function ciPlan(event: string, changed: string[] | null): CiPlan {
  if (event !== "pull_request" || changed === null) return { ...FULL };
  const any = (re: RegExp) => changed.some((path) => re.test(path));
  const everything = any(EVERYTHING);
  const daemon = everything || any(DAEMON);
  return {
    windows: daemon || any(SCRIPTS),
    smokes: daemon,
    screenshots: everything,
    cargo: any(TAURI),
    e2e: everything || any(E2E),
  };
}

/** The plan as GitHub step outputs, one `name=value` per line. */
export function planOutputs(plan: CiPlan): string {
  return (Object.keys(FULL) as (keyof CiPlan)[]).map((key) => `${key}=${plan[key]}\n`).join("");
}
