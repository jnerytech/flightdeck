import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectsCloneResult, ProjectsScanResult } from "@flightdeck/protocol";
import { FlightdeckError } from "./errors.ts";
import { isInside } from "./paths.ts";

export interface ScanOptions {
  /** How many levels below a root are looked at (2 by default). */
  depth?: number;
  /** The most repositories returned (200 by default). */
  cap?: number;
}

const DEFAULT_DEPTH = 2;
const DEFAULT_CAP = 200;
/** The most folders one scan opens, so a huge tree cannot keep the daemon busy. */
const MAX_FOLDERS = 2_000;
const SKIPPED = new Set(["node_modules"]);

/** The real path of a folder, or null when it is missing or not a folder. */
async function realFolder(path: string): Promise<string | null> {
  try {
    const real = await realpath(path);
    return (await stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/** A folder with `.git` (a folder, or a file in a worktree) is a repository. */
const isRepo = (dir: string) =>
  lstat(join(dir, ".git")).then(
    () => true,
    () => false,
  );

/**
 * Looks for git repositories under the allowed roots. It never blocks the daemon (every call is
 * async), never follows a link, skips hidden folders and `node_modules`, does not enter a
 * repository it found, and stops at a cap of repositories and of folders opened.
 */
export async function scanRepos(
  roots: readonly string[],
  options: ScanOptions = {},
): Promise<ProjectsScanResult> {
  const depth = options.depth ?? DEFAULT_DEPTH;
  const cap = options.cap ?? DEFAULT_CAP;
  const real = await Promise.all(roots.map(realFolder));
  const found = new Map<string, { name: string; path: string; root: string }>();
  let truncated = false;
  let opened = 0;
  const add = (path: string, root: string) => {
    if (found.has(path)) return true;
    if (found.size >= cap) {
      truncated = true;
      return false;
    }
    found.set(path, { name: path.split(/[\\/]/).pop() ?? path, path, root });
    return true;
  };

  for (const root of new Set(real.filter((r): r is string => r !== null))) {
    if (await isRepo(root)) {
      if (!add(root, root)) break;
      continue;
    }
    let level = [root];
    for (let n = 1; n <= depth && level.length > 0 && !truncated; n++) {
      const next: string[] = [];
      for (const dir of level) {
        if (truncated || opened >= MAX_FOLDERS) {
          truncated = true;
          break;
        }
        opened++;
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".") || SKIPPED.has(entry.name)) {
            continue;
          }
          const child = join(dir, entry.name);
          if (await isRepo(child)) {
            if (!add(child, root)) break;
          } else next.push(child);
        }
      }
      level = next;
    }
    if (truncated) break;
  }
  const repos = [...found.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  return { repos, truncated };
}

/** Runs `git` with these arguments; the exit code and what it said on stderr. */
export type GitRunner = (args: string[]) => Promise<{ code: number; stderr: string }>;

export interface CloneRequest {
  url: string;
  root: string;
  name?: string;
}

const refuse = (
  code: "bad_request" | "invalid_state",
  reason: string,
  message: string,
  params?: Record<string, string | number>,
) => new FlightdeckError(code, message, reason, params);

const SCHEMES = [/^https:\/\//i, /^ssh:\/\//i, /^[\w.-]+@[\w.-]+:\S/];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The folder name a URL implies: its last path segment without `.git`; null when it has none. */
function nameOf(url: string): string | null {
  const path = /^[\w.-]+@[\w.-]+:/.test(url)
    ? url.slice(url.indexOf(":") + 1)
    : URL.canParse(url)
      ? new URL(url).pathname
      : "";
  const last = path.split("/").filter(Boolean).pop();
  return last ? last.replace(/\.git$/i, "") : null;
}

/** Lets only an https or ssh address through: no option, no local path, no transport helper. */
function checkUrl(url: string): void {
  if (url.startsWith("-")) {
    throw refuse("bad_request", "clone_url_invalid", "the address cannot start with a dash");
  }
  if (!SCHEMES.some((scheme) => scheme.test(url))) {
    throw refuse("bad_request", "clone_url_scheme", "only https:// and ssh addresses are cloned");
  }
  if (/\s/.test(url) || [...url].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    throw refuse(
      "bad_request",
      "clone_url_invalid",
      "the address has spaces or control characters",
    );
  }
}

/** The root, as a real path, when it is a folder inside the allowed roots. */
async function allowedRoot(root: string, roots: readonly string[]): Promise<string> {
  const real = await realFolder(root);
  const allowed = await Promise.all(roots.map(realFolder));
  if (real && allowed.some((r) => r !== null && isInside(r, real))) return real;
  throw new FlightdeckError(
    "forbidden_cwd",
    `directory outside allowedRoots: ${root}`,
    "cwd_outside_roots",
    { cwd: root },
  );
}

/** The last line git printed, which is the one that says what went wrong. */
const lastLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop()
    ?.slice(0, 300) ?? "";

/** Clones into a folder inside the roots; refuses with a reason the app can translate. */
export async function cloneRepo(
  request: CloneRequest,
  roots: readonly string[],
  git: GitRunner,
): Promise<ProjectsCloneResult> {
  const url = request.url.trim();
  checkUrl(url);
  const name = request.name ?? nameOf(url);
  if (name === null || !NAME.test(name)) {
    throw refuse("bad_request", "clone_name_invalid", "the folder name is not usable");
  }
  const root = await allowedRoot(request.root, roots);
  const path = join(root, name);
  if (
    await lstat(path).then(
      () => true,
      () => false,
    )
  ) {
    throw refuse("invalid_state", "clone_exists", `${path} already exists`, { path });
  }
  const { code, stderr } = await git(["clone", "--", url, path]);
  if (code !== 0) {
    const detail = lastLine(stderr);
    throw refuse("invalid_state", "clone_failed", `git clone failed: ${detail}`, { detail });
  }
  return { path };
}

const CLONE_TIMEOUT_MS = 5 * 60_000;
/** How long the text of stderr is waited for once git itself has ended. */
const STDERR_GRACE_MS = 2_000;

/** A `git` runner: no prompt for a password, and a command still running after `timeoutMs` is stopped. */
export const gitRunner =
  (timeoutMs: number): GitRunner =>
  async (args) => {
    const proc = Bun.spawn(["git", ...args], {
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const stderr = new Response(proc.stderr).text();
      const code = await proc.exited;
      // A child that outlives a killed git can hold the pipe open: its text is not worth the wait.
      return {
        code,
        stderr: await Promise.race([stderr, Bun.sleep(STDERR_GRACE_MS).then(() => "")]),
      };
    } finally {
      clearTimeout(timer);
    }
  };

/** The real `git`, with the five minutes a clone gets. */
export const spawnGit: GitRunner = gitRunner(CLONE_TIMEOUT_MS);
