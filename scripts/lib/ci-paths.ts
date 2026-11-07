/**
 * Which CI jobs a pull request needs, from the paths it changes (issue #264). Docs or scripts only
 * run the Linux tests and lint; the daemon adds the smokes; the demo and the print guards add the
 * prints (#637); the app, the protocol, the
 * dependencies or the workflow itself run everything; the Tauri shell adds cargo. Windows is not
 * planned for a PR or a push to main (#534); the schedule and a run by hand run everything,
 * Windows included, as a signal that gates nothing.
 */

import { GLOBAL_FILE, TEST_FILE } from "./test-related.ts";

export interface CiPlan {
  /** The Windows test shards and the Windows checks: the schedule's and a run by hand's only (#534). */
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
/**
 * The journeys, their Playwright config and the demo they drive (#399). The demo seed starts the
 * real daemon and uses the scripts' test helpers (fake CLIs, temp folders), so those count too
 * (#410 review); ci-paths.test.ts checks every file the seed imports, and every script file the
 * journeys import, such as the layout guards (#637).
 */
const E2E =
  /^(?:scripts\/e2e\/|scripts\/lib\/(?:(?:e2e|demo)[^/]*|browser|layout-guards)\.ts$|scripts\/demo[^/]*\.ts$|playwright[^/]*$|apps\/daemon\/|scripts\/test\/(?![^/]*\.test\.ts$)[^/]+\.ts$)/;

/**
 * demo:shots and what it runs (#637): the demo, the print guards, their ratchets and axe. A change
 * to a guard must run the prints it guards; ci-paths.test.ts checks every local file demo-shots
 * imports.
 */
const SHOTS =
  /^scripts\/(?:demo[^/]*\.ts|lib\/(?:axe|browser|layout-guards|print-theme|shots-[^/]*|visual)\.ts)$/;

/**
 * Above this many selected integration and e2e test files, a PR's Windows tests take three shards
 * (#444, #483). Every PR selects the ~600 fast-tier tests, which one shard runs in minutes; a PR on
 * a widely imported file adds hundreds of slow ones (about 420 of #479's 1021).
 */
export const WINDOWS_SPLIT_ABOVE = 100;

export function ciPlan(
  event: string,
  changed: string[] | null,
  removed: string[] = [],
  selected = 0,
): CiPlan {
  // A PR and a push to main plan by their paths (#444); the schedule and a run by hand run all.
  const partial = event === "pull_request" || event === "push";
  if (!partial) return { ...FULL };
  // Windows is off the PR path and main's push (#534): the person tests it by hand, and delivery
  // does not wait for a slow runner. Only the schedule and a run by hand keep it, as a signal.
  if (changed === null) return { ...FULL, windows: false };
  const any = (re: RegExp) => changed.some((path) => re.test(path));
  const everything = any(EVERYTHING);
  const daemon = everything || any(DAEMON);
  return {
    windows: false,
    smokes: daemon,
    screenshots: everything || any(SHOTS),
    cargo: any(TAURI),
    e2e: everything || any(E2E),
    windowsShards:
      any(GLOBAL_FILE) ||
      removed.some((path) => TEST_FILE.test(path)) ||
      selected > WINDOWS_SPLIT_ABOVE
        ? 3
        : 1,
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
