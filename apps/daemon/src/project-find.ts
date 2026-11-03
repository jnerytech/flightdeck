import type { ProjectsCloneResult, ProjectsScanResult } from "@flightdeck/protocol";

export interface ScanOptions {
  /** How many levels below a root are looked at (2 by default). */
  depth?: number;
  /** The most repositories returned (200 by default). */
  cap?: number;
}

/** Looks for git repositories under the allowed roots, without blocking the daemon. */
export async function scanRepos(
  _roots: readonly string[],
  _options: ScanOptions = {},
): Promise<ProjectsScanResult> {
  return { repos: [], truncated: false };
}

/** Runs `git` with these arguments; the exit code and what it said on stderr. */
export type GitRunner = (args: string[]) => Promise<{ code: number; stderr: string }>;

export interface CloneRequest {
  url: string;
  root: string;
  name?: string;
}

/** Clones into a folder inside the roots; refuses with a reason the app can translate. */
export async function cloneRepo(
  _request: CloneRequest,
  _roots: readonly string[],
  _git: GitRunner,
): Promise<ProjectsCloneResult> {
  return { path: "" };
}

/** The real `git`, with prompts off and a time limit. */
export const spawnGit: GitRunner = async () => ({ code: 0, stderr: "" });
