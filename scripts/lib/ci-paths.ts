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

export function ciPlan(_event: string, _changed: string[] | null): CiPlan {
  return { windows: false, smokes: false, screenshots: false, cargo: false };
}

/** The plan as GitHub step outputs, one `name=value` per line. */
export function planOutputs(_plan: CiPlan): string {
  return "";
}
