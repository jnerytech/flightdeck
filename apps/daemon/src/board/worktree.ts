import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { type CommandResult, git } from "./command.ts";

/** Line added to `.git/info/exclude`: worktrees live inside the repo but never show up in it.
 * Only the worktrees: phase 5 keeps versioned workflows in `.flightdeck/workflows`. */
export const EXCLUDE_LINE = ".flightdeck/worktrees/";

/** Throws with git's own message when a command fails. */
export function must(result: CommandResult, what: string): CommandResult {
  if (result.code !== 0)
    throw new FlightdeckError("invalid_state", `${what}: ${result.stderr.trim()}`);
  return result;
}

/** `Ação: corrigir o Login!` → `acao-corrigir-o-login`; `card` when nothing is left. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return slug || "card";
}

export const worktreeDir = (repo: string, slug: string) =>
  join(repo, ".flightdeck", "worktrees", slug);

/** First of `base`, `base-2`, `base-3`… with neither a branch nor a folder yet. */
async function freeSlug(repo: string, base: string): Promise<string> {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const branch = await git(repo, "show-ref", "--verify", "--quiet", `refs/heads/fd/${slug}`);
    if (branch.code !== 0 && !existsSync(worktreeDir(repo, slug))) return slug;
  }
}

/** Adds `.flightdeck/worktrees/` to the repo's local exclude file, once; `.gitignore` is never touched. */
async function excludeFlightdeck(repo: string): Promise<void> {
  const where = must(await git(repo, "rev-parse", "--git-path", "info/exclude"), "git rev-parse");
  const file = resolve(repo, where.stdout.trim());
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split(/\r?\n/).includes(EXCLUDE_LINE)) return;
  mkdirSync(dirname(file), { recursive: true });
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${current}${separator}${EXCLUDE_LINE}\n`);
}

/** `git worktree add <repo>/.flightdeck/worktrees/<slug> -b fd/<slug> <base>`. */
export async function addWorktree(
  repo: string,
  title: string,
  base: string,
): Promise<{ slug: string; branch: string; path: string }> {
  const slug = await freeSlug(repo, slugify(title));
  const branch = `fd/${slug}`;
  const path = worktreeDir(repo, slug);
  await excludeFlightdeck(repo);
  must(await git(repo, "worktree", "add", path, "-b", branch, base), "git worktree add");
  return { slug, branch, path };
}
