/**
 * `bun run scripts/release-highlights.ts [--since <tag>]` (issue #1334): a draft of a release's
 * Highlights from the PRs merged into main since the last tag, for the coordinator to edit. It
 * keeps the PRs with a user-facing commit (feat or fix, not a Sonar or CI scope), groups them by
 * their issue, and prints one bullet per issue under a heading by area. It only reads, with gh.
 */
import type { GhResult } from "./ci-branch.ts";

export const REPO = "jnerytech/flightdeck";

/** The headings of the draft, in order; an issue no keyword places goes to Other. */
export const AREAS = [
  "Board",
  "Workflows",
  "Sessions",
  "Costs",
  "Backup",
  "Hosts",
  "Quality",
  "Other",
] as const;
export type Area = (typeof AREAS)[number];

/** A PR merged into main, as the search returns it. */
export interface MergedPr {
  number: number;
  title: string;
  mergedAt: string;
  headRefName: string;
  /** The issues it closes (GitHub's closing references). */
  closes: number[];
  commits: { headline: string; body: string }[];
}

export interface HighlightsDeps {
  gh: (args: string[]) => Promise<GhResult>;
  log: (line: string) => void;
}

/** Whether a PR carries a user-facing change: a feat or fix commit outside Sonar and CI. */
export function userFacing(_pr: MergedPr): boolean {
  return false;
}

/** The issue a PR belongs to: the one it closes, else the one its feat and fix commits name most. */
export function issueOf(_pr: MergedPr): number | null {
  return null;
}

/** The heading an issue goes under, from its title and its commits' scopes. */
export function areaOf(_text: string): Area {
  return "Other";
}

/** The Markdown draft: one bullet per issue, with its PRs, under its area. */
export function highlightsDraft(
  _since: string,
  _prs: MergedPr[],
  _titles: ReadonlyMap<number, string>,
): string {
  return "";
}

/** Prints the draft; 0 when it did, 1 when GitHub could not be read, 2 for a bad argument. */
export async function releaseHighlights(_args: string[], _deps: HighlightsDeps): Promise<number> {
  return 0;
}
