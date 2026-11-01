import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

/** Where each repository keeps its exclude file: it does not move, so git is asked once. */
const excludeFiles = new Map<string, string>();

const excludePathCommand = () => [
  whichOnPath("git") ?? "git",
  "rev-parse",
  "--git-path",
  "info/exclude",
];
const spawnOptions = (repo: string) =>
  ({ cwd: repo, env: process.env, stdout: "pipe", stderr: "pipe" }) as const;

function excludeFileFrom(repo: string, code: number, out: string, err: string): string {
  if (code !== 0) throw new FlightdeckError("invalid_state", `git rev-parse: ${err.trim()}`);
  const file = resolve(repo, out.trim());
  excludeFiles.set(repo, file);
  return file;
}

/** The exclude file of `repo`, asking git without waiting for it the first time. */
async function excludeFileAsync(repo: string): Promise<string> {
  const known = excludeFiles.get(repo);
  if (known) return known;
  const proc = Bun.spawn(excludePathCommand(), { ...spawnOptions(repo), stdin: "ignore" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return excludeFileFrom(repo, code, out, err);
}

/**
 * The exclude file of `repo`, waiting for git if nobody looked it up yet. Every launch looks it
 * up first (`excludeLocalSettingsAsync`), so this waits only for a repository the daemon has not
 * launched a card in since it started: a rule accepted in a card resumed after a restart.
 */
function excludeFileSync(repo: string): string {
  const known = excludeFiles.get(repo);
  if (known) return known;
  const proc = Bun.spawnSync(excludePathCommand(), spawnOptions(repo));
  return excludeFileFrom(repo, proc.exitCode, proc.stdout.toString(), proc.stderr.toString());
}

/**
 * Adds a line to the repo's local exclude file, once; `.gitignore` is never touched. It is the
 * common git dir, so it holds for every worktree of the repository too.
 */
function addExcludeLine(file: string, line: string): void {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split(/\r?\n/).includes(line)) return;
  mkdirSync(dirname(file), { recursive: true });
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${current}${separator}${line}\n`);
}

/**
 * The rules file never shows up in a card's diff nor in a commit of the agent. Ensured on every
 * launch and before every write, so worktrees made before phase 7 get it too. Synchronous
 * because it is also called right before a rule is written, in the middle of an answer; the
 * launch uses `excludeLocalSettingsAsync` first, so git has been asked by then.
 */
export function excludeLocalSettings(repo: string): void {
  addExcludeLine(excludeFileSync(repo), LOCAL_SETTINGS);
}

/** The same without waiting for git: the event loop keeps serving while it looks. */
export async function excludeLocalSettingsAsync(repo: string): Promise<void> {
  addExcludeLine(await excludeFileAsync(repo), LOCAL_SETTINGS);
}

/** Patterns (in the `.gitignore` format) of ignored files a new worktree gets from the repo. */
export const WORKTREE_INCLUDE = ".worktreeinclude";

/** What `.worktreeinclude` copies into a new worktree, at most (bytes). */
export const WORKTREE_INCLUDE_LIMIT = 50 * 1024 * 1024;

/** Which of `paths` git ignores (`.gitignore`, `info/exclude`…), through `check-ignore --stdin`. */
async function ignoredOf(repo: string, paths: string[]): Promise<Set<string>> {
  const proc = Bun.spawn([whichOnPath("git") ?? "git", "check-ignore", "-z", "--stdin"], {
    cwd: repo,
    env: process.env,
    stdin: new TextEncoder().encode(paths.map((p) => `${p}\0`).join("")),
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return new Set(out.split("\0").filter(Boolean));
}

/**
 * Copies into the worktree the files git ignores that match `.worktreeinclude`, plus the
 * built-in `.claude/settings.local.json` (the project rules of phase 7), sorted by path, up to
 * `limit` bytes in all. Tracked files already come with the worktree; nothing from `.git/` or
 * `.flightdeck/`. Returns what was copied and what the limit left out.
 */
export async function copyIncluded(
  repo: string,
  worktree: string,
  limit = WORKTREE_INCLUDE_LIMIT,
): Promise<{ copied: string[]; skipped: string[] }> {
  const include = join(repo, WORKTREE_INCLUDE);
  const listed = must(
    await git(
      repo,
      "-c",
      "core.quotePath=false",
      "ls-files",
      "--others",
      "--ignored",
      "-z",
      `--exclude=/${LOCAL_SETTINGS}`,
      ...(existsSync(include) ? [`--exclude-from=${include}`] : []),
    ),
    "git ls-files",
  );
  const matching = listed.stdout
    .split("\0")
    .filter((path) => path && !path.startsWith(".flightdeck/") && !path.startsWith(".git/"));
  const ignored = await ignoredOf(repo, matching);
  const copied: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const path of matching
    .filter((p) => ignored.has(p))
    .sort((a, b) => (a < b ? -1 : Number(a > b)))) {
    const size = statSync(join(repo, path)).size;
    if (total + size > limit) {
      skipped.push(path);
      continue;
    }
    total += size;
    mkdirSync(dirname(join(worktree, path)), { recursive: true });
    copyFileSync(join(repo, path), join(worktree, path));
    copied.push(path);
  }
  return { copied, skipped };
}

/** The tail of the line of worktrees being added, per repository. */
const adding = new Map<string, Promise<unknown>>();

/**
 * `git worktree add <repo>/.flightdeck/worktrees/<slug> -b fd/<slug> <base>`. One at a time per
 * repository: two at once read each other's half-made admin folder in `.git/worktrees` and fail,
 * and two cards with the same title would pick the same free slug.
 */
export function addWorktree(
  repo: string,
  title: string,
  base: string,
  includeLimit = WORKTREE_INCLUDE_LIMIT,
): Promise<{ slug: string; branch: string; path: string; skipped: string[] }> {
  const key = resolve(repo);
  const job = (adding.get(key) ?? Promise.resolve()).then(() =>
    create(repo, title, base, includeLimit),
  );
  const tail = job.then(
    () => undefined,
    () => undefined,
  );
  adding.set(key, tail);
  void tail.then(() => {
    if (adding.get(key) === tail) adding.delete(key);
  });
  return job;
}

async function create(
  repo: string,
  title: string,
  base: string,
  includeLimit = WORKTREE_INCLUDE_LIMIT,
): Promise<{ slug: string; branch: string; path: string; skipped: string[] }> {
  const slug = await freeSlug(repo, slugify(title));
  const branch = `fd/${slug}`;
  const path = worktreeDir(repo, slug);
  addExcludeLine(await excludeFileAsync(repo), EXCLUDE_LINE);
  await excludeLocalSettingsAsync(repo);
  must(await git(repo, "worktree", "add", path, "-b", branch, base), "git worktree add");
  const { skipped } = await copyIncluded(repo, path, includeLimit);
  return { slug, branch, path, skipped };
}
