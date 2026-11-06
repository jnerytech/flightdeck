/**
 * Which CI jobs a pull request needs, from the paths it changes (issue #264). Docs or scripts only
 * run the Linux tests and lint; the daemon adds Windows and the smokes; the app, the protocol, the
 * dependencies or the workflow itself run everything; the Tauri shell adds cargo. A push to main,
 * a run by hand, or a diff that cannot be read runs everything.
 */

import { GLOBAL_FILE, TEST_FILE } from "./test-related.ts";

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
  /**
   * How many Windows test shards (#444): one on a PR, three when the whole suite runs there (a file
   * every test reads changed, or a test went away: the rule of `test:related --pr`) and off a PR.
   */
  windowsShards: number;
}

export const FULL: CiPlan = {
  windows: true,
  smokes: true,
  screenshots: true,
  cargo: true,
  e2e: true,
  windowsShards: 3,
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

export function ciPlan(event: string, changed: string[] | null, removed: string[] = []): CiPlan {
  // A PR and a push to main plan by their paths (#444); the schedule and a run by hand run all.
  if ((event !== "pull_request" && event !== "push") || changed === null) return { ...FULL };
  const any = (re: RegExp) => changed.some((path) => re.test(path));
  const everything = any(EVERYTHING);
  const daemon = everything || any(DAEMON);
  return {
    windows: daemon || any(SCRIPTS),
    smokes: daemon,
    screenshots: everything,
    cargo: any(TAURI),
    e2e: everything || any(E2E),
    windowsShards: any(GLOBAL_FILE) || removed.some((path) => TEST_FILE.test(path)) ? 3 : 1,
  };
}

/**
 * The ref `test:related --pr` compares with (#444): the PR's target branch, or the commit a push
 * to main came after; none ("") for the schedule and a run by hand, which run the whole suite.
 * A push's before must be a commit id (a new branch's is all zeros).
 */
export function selectionBase(event: string, baseRef: string, before: string): string {
  if (event === "pull_request") return baseRef ? `origin/${baseRef}` : "";
  if (event === "push" && /^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before)) return before;
  return "";
}

/** The plan as GitHub step outputs, one `name=value` per line. */
export function planOutputs(plan: CiPlan): string {
  const value = (key: keyof CiPlan) =>
    key === "windowsShards"
      ? `windows_shards=${JSON.stringify(Array.from({ length: plan.windowsShards }, (_, i) => i + 1))}`
      : `${key}=${plan[key]}`;
  return (Object.keys(FULL) as (keyof CiPlan)[]).map((key) => `${value(key)}\n`).join("");
}
