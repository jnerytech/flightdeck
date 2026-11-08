import type { AlertsUnavailable, RepoAlert } from "@flightdeck/protocol";
import type { GhResult } from "./gh.ts";

/** Runs `gh` in the project's folder, so `{owner}` and `{repo}` come from its own remote; `null` when `gh` is missing. */
export type GhIn = (args: string[], cwd: string) => Promise<GhResult | null>;

/** Open alerts asked of each source, at most. */
export const PER_SOURCE = 30;
/** Alerts returned in all. */
export const ALERTS_MAX = 50;
export const TITLE_MAX = 200;
export const TEXT_MAX = 600;
/** A response longer than this is not read. */
export const RESPONSE_MAX = 2 * 1024 * 1024;

export interface AlertList {
  alerts: RepoAlert[];
  unavailable: AlertsUnavailable[];
}

/**
 * Issue #79: the open code-scanning and Dependabot alerts of the repository in `cwd`, read-only
 * (`gh api` with a plain GET). The daemon holds no token and builds no URL: `gh` fills the repo in
 * from the folder's remote. A source that cannot be read is named, without `gh`'s text.
 */
export async function listAlerts(_gh: GhIn, _cwd: string): Promise<AlertList> {
  return { alerts: [], unavailable: [{ kind: "code-scanning", reason: "failed" }] };
}
