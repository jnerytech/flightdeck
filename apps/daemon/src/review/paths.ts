import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";
import { credential } from "../permissions/sensitive-paths.ts";

/** The first step of a path relative to the repository's root. */
const firstStep = (inside: string) => inside.split(/[\\/]/)[0] ?? "";

/**
 * `.git` as a filesystem may take it: in any case (Windows and macOS do not tell them apart) and
 * with trailing dots or spaces (Windows drops them).
 */
const isGitDir = (name: string) => name.replace(/[. ]+$/, "").toLowerCase() === ".git";

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
    path === "" ||
    // Windows: a colon names a stream (`.git::$INDEX_ALLOCATION`), never part of a file name.
    (process.platform === "win32" && path.includes(":"))
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

/**
 * Where a path would really be: its nearest part that exists, links resolved, and the rest after
 * it. `null` when a part of it is a link that leads nowhere yet: writing through it would create
 * whatever it names.
 */
async function wouldBe(path: string): Promise<string | null> {
  const real = await realpath(path).catch(() => null);
  if (real) return real;
  if ((await lstat(path).catch(() => null))?.isSymbolicLink()) return null;
  const parent = dirname(path);
  if (parent === path) return null;
  const above = await wouldBe(parent);
  return above && join(above, basename(path));
}

/** A file of the repository and where it really is: refused when a link takes it out of the repository. */
export async function located(root: string, realRoot: string, path: string): Promise<Located> {
  const full = fileInRoot(root, path);
  const real = await realpath(full).catch(() => null);
  // A file not there yet is judged by where it would go: its nearest folder that is there, resolved.
  const where = real ?? (await wouldBe(full));
  if (!where || !isInside(realRoot, where)) {
    throw new FlightdeckError(
      "forbidden_cwd",
      `${path} points outside the repository`,
      "review_path_link",
      { path },
    );
  }
  // A link into `.git` is `.git`.
  if (isGitDir(firstStep(relative(realRoot, where)))) {
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
