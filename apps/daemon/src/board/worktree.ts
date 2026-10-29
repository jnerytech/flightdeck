import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";
import { type CommandResult, git } from "./command.ts";
import { LOCAL_SETTINGS } from "./project-rules.ts";

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

/**
 * Adds a line to the repo's local exclude file, once; `.gitignore` is never touched. It is the
 * common git dir, so it holds for every worktree of the repository too.
 */
function exclude(repo: string, line: string): void {
  // Synchronous: also called right before a rule is written, in the middle of an answer.
  const where = Bun.spawnSync(
    [whichOnPath("git") ?? "git", "rev-parse", "--git-path", "info/exclude"],
    {
      cwd: repo,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (where.exitCode !== 0) {
    throw new FlightdeckError("invalid_state", `git rev-parse: ${where.stderr.toString().trim()}`);
  }
  const file = resolve(repo, where.stdout.toString().trim());
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split(/\r?\n/).includes(line)) return;
  mkdirSync(dirname(file), { recursive: true });
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${current}${separator}${line}\n`);
}

/**
 * The rules file never shows up in a card's diff nor in a commit of the agent. Ensured on every
 * launch and before every write, so worktrees made before phase 7 get it too.
 */
export function excludeLocalSettings(repo: string): void {
  exclude(repo, LOCAL_SETTINGS);
}

/**
 * A new worktree gets the root's settings.local.json (the project rules), unless the repository
 * versions that file: then the worktree already has the committed one.
 */
async function copyLocalSettings(repo: string, worktree: string): Promise<void> {
  const source = join(repo, LOCAL_SETTINGS);
  if (!existsSync(source)) return;
  const tracked = await git(repo, "ls-files", "--error-unmatch", LOCAL_SETTINGS);
  if (tracked.code === 0) return;
  mkdirSync(dirname(join(worktree, LOCAL_SETTINGS)), { recursive: true });
  copyFileSync(source, join(worktree, LOCAL_SETTINGS));
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
  exclude(repo, EXCLUDE_LINE);
  excludeLocalSettings(repo);
  must(await git(repo, "worktree", "add", path, "-b", branch, base), "git worktree add");
  await copyLocalSettings(repo, path);
  return { slug, branch, path };
}
