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
}

export const FULL: CiPlan = { windows: true, smokes: true, screenshots: true, cargo: true };

/** What every job reads: the app, the protocol, the dependencies, the configs and CI itself. */
const EVERYTHING =
  /^(?:apps\/desktop\/|packages\/|\.github\/workflows\/)|^(?:package\.json|bun\.lock|bunfig[^/]*\.toml|tsconfig[^/]*\.json)$/;
const DAEMON = /^apps\/daemon\/|^scripts\/smoke-[^/]+\.ts$/;
const TAURI = /^apps\/desktop\/src-tauri\//;

export function ciPlan(event: string, changed: string[] | null): CiPlan {
  if (event !== "pull_request" || changed === null) return { ...FULL };
  const any = (re: RegExp) => changed.some((path) => re.test(path));
  const everything = any(EVERYTHING);
  const daemon = everything || any(DAEMON);
  return { windows: daemon, smokes: daemon, screenshots: everything, cargo: any(TAURI) };
}

/** The plan as GitHub step outputs, one `name=value` per line. */
export function planOutputs(plan: CiPlan): string {
  return (Object.keys(FULL) as (keyof CiPlan)[]).map((key) => `${key}=${plan[key]}\n`).join("");
}
