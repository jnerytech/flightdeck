/** The port of the `github` domain onto `gh`: what a run answers and the shape of one that runs it (#1612). */

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The run was killed at its limit. */
  timedOut?: boolean;
}

/** Runs `gh`; `null` when it is not installed. */
export type GhRunner = (args: string[]) => Promise<GhResult | null>;
