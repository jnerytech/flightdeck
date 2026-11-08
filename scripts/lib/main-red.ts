/**
 * Issue #1246: a red main is claimed once, and every session sees the claim before fixing it.
 * `bun run main-red` reads main's latest finished CI run and the open `main-red` issues; `claim`
 * opens one issue per red, refused when another owner already claimed one of its failing tests.
 * The SessionStart hook and `bun run pr -- open/update` print the one-line warning.
 */
import type { GhResult } from "./pr-flow.ts";

export interface MainRedDeps {
  /** Runs `gh <args>` in the repository. */
  gh(args: string[]): Promise<GhResult>;
  log(line: string): void;
}

/** Main's latest CI run that finished green or red (a cancelled one says nothing). */
export interface MainRun {
  id: number;
  url: string;
  createdAt: string;
  red: boolean;
}

/** An open `main-red` issue, read back from its title and body. */
export interface Claim {
  number: number;
  cause: string;
  owner: string;
  failing: string[];
  runAt: string;
}

export async function latestMainRun(_deps: Pick<MainRedDeps, "gh">): Promise<MainRun | null> {
  return null;
}

export async function openClaims(_deps: Pick<MainRedDeps, "gh">): Promise<Claim[]> {
  return [];
}

/** The one-line warning while main is red, or null when it is green or GitHub cannot say. */
export async function mainRedLine(_deps: Pick<MainRedDeps, "gh">): Promise<string | null> {
  return null;
}

/** `main-red [claim "<cause>" [--by <name>]]`; the exit code. */
export async function mainRed(
  _args: string[],
  _deps: MainRedDeps & { owner: string },
): Promise<number> {
  return 0;
}
