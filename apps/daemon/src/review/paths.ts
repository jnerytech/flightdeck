import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";
import { credential } from "../permissions/sensitive-paths.ts";

/** The first step of a path relative to the repository's root. */
export const firstStep = (inside: string) => inside.split(/[\\/]/)[0] ?? "";

/**
 * `.git` as a filesystem may take it: in any case (Windows and macOS do not tell them apart) and
 * with trailing dots or spaces (Windows drops them).
 */
export const isGitDir = (name: string) => name.replace(/[. ]+$/, "").toLowerCase() === ".git";

/**
 * A file of the review, given relative to the repository: never absolute, never above the root
 * and never inside `.git`, however it is spelled (`./.git`, `.GIT`, issue #509). Returns the full
 * path.
 */
export function fileInRoot(root: string, path: string): string {
  const segments = path.split(/[\\/]/);
  const full = join(root, path);
  if (
    isAbsolute(path) ||
    segments.includes("..") ||
    isGitDir(firstStep(relative(root, full))) ||
    path === ""
  ) {
    throw new FlightdeckError(
      "bad_request",
      `path outside the repository: ${path}`,
      "review_path_outside",
      { path },
    );
  }
  return full;
}

/** Lines of a text, without the line breaks (a last empty line does not count). */
export const linesOf = (text: string) => text.replace(/\r?\n$/, "").split(/\r?\n/);

export interface Located {
  full: string;
  /** Where its links lead; `null` when the file is not there. */
  real: string | null;
  realRoot: string;
}

/** A file of the repository and where it really is: refused when a link takes it out of the repository. */
export async function located(root: string, realRoot: string, path: string): Promise<Located> {
  const full = fileInRoot(root, path);
  const real = await realpath(full).catch(() => null);
  if (real && !isInside(realRoot, real)) {
    throw new FlightdeckError(
      "forbidden_cwd",
      `${path} points outside the repository`,
      "review_path_link",
      { path },
    );
  }
  // A link into `.git` is `.git`.
  if (real && isGitDir(firstStep(relative(realRoot, real)))) {
    throw new FlightdeckError(
      "bad_request",
      `path outside the repository: ${path}`,
      "review_path_outside",
      { path },
    );
  }
  return { full, real, realRoot };
}

/**
 * Refuses a file that may hold a credential (the list of issue #449), named by the path asked for
 * or by where its links lead (issue #509): Flightdeck neither shows nor changes it.
 */
export function refuseCredential({ real, realRoot }: Located, path: string): void {
  if (credential(path) || (real !== null && credential(relative(realRoot, real)))) {
    throw new FlightdeckError(
      "bad_request",
      `${path} may hold a credential`,
      "review_file_secret",
      { path },
    );
  }
}
