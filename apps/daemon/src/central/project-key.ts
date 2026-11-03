import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { whichOnPath } from "../which.ts";

export type GitResult = { code: number; stdout: string };
/** Asks git without waiting for the process: the event loop keeps serving while git runs. */
export type AsyncGitRunner = (args: string[]) => Promise<GitResult>;

/** Whether `path` exists, asked without blocking. */
const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

const runGitAsync: AsyncGitRunner = async (args) => {
  const proc = Bun.spawn([whichOnPath("git") ?? "git", ...args], {
    env: process.env,
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
};

/**
 * `git@github.com:Acme/Repo.git`, `https://github.com/acme/repo` and `ssh://git@github.com:22/…`
 * all become `github.com/acme/repo`: no scheme, user, port, trailing `.git`, in lowercase.
 */
export function normalizeRemote(url: string): string {
  return stripRemote(url).toLowerCase();
}

/** The remote as `host/path`: no scheme, user, port or trailing `.git`, case kept. */
export function stripRemote(url: string): string {
  const trimmed = url.trim();
  const scp = /^[^/@]+@([^:/]+):(.+)$/.exec(trimmed);
  const path =
    scp && !trimmed.includes("://")
      ? `${scp[1]}/${scp[2]}`
      : trimmed
          .replace(/^[a-z+]+:\/\//i, "")
          .replace(/^[^@/]+@/, "")
          .replace(/^([^/:]+):\d+\//, "$1/");
  return path.replace(/\/+$/, "").replace(/\.git$/i, "");
}

// The common dir is the main repository's .git, also from inside a worktree.
const commonDirArgs = (cwd: string) => [
  "-C",
  cwd,
  "rev-parse",
  "--path-format=absolute",
  "--git-common-dir",
];
const remoteArgs = (root: string) => ["-C", root, "config", "--get", "remote.origin.url"];

/** The repository root a common dir belongs to. */
function rootOf(commonDir: string): string {
  const dir = resolve(commonDir.trim());
  return basename(dir) === ".git" ? dirname(dir) : dir;
}

/**
 * Groups sessions by project: the normalized `remote.origin.url` of the repository holding the
 * cwd (worktrees count as their main repository), else `host:<hostId>:<repository root>`, else
 * `host:<hostId>:<cwd>`. Cached per cwd for the life of the daemon.
 *
 * Nothing here waits for a process or the disk. `resolve` asks git and is the answer to wait for;
 * `lookup` is the cached key or the promise of it; `known` is for the places that need a string
 * on the spot (a list being built, a rule being matched): the cached key, else the folder key
 * while one lookup runs in the background, so the next call is right.
 */
export class ProjectKeys {
  private readonly cache = new Map<string, string>();
  /** The cwds cached with a folder key because git found no repository: whether `.git` existed then. */
  private readonly notRepo = new Map<string, boolean>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    readonly hostId: string,
    private readonly git: AsyncGitRunner = runGitAsync,
  ) {}

  /** The cached key, or the folder key while a lookup in the background finds the real one. */
  known(cwd: string): string {
    const key = this.cache.get(cwd);
    // A folder cached without a repository is looked at again: it may have become one.
    if (!key || this.notRepo.has(cwd)) void this.resolve(cwd);
    return key ?? this.folderKey(cwd);
  }

  /** The key without blocking: the cached one, else a promise of it. */
  lookup(cwd: string): string | Promise<string> {
    return this.cache.get(cwd) ?? this.resolve(cwd);
  }

  /**
   * The key, asking git without blocking the event loop; asked once per cwd, then cached. A folder
   * cached without a repository is asked again when its `.git` is not what it was then.
   */
  resolve(cwd: string): Promise<string> {
    const cached = this.cache.get(cwd);
    if (cached && !this.notRepo.has(cwd)) return Promise.resolve(cached);
    let pending = this.pending.get(cwd);
    if (!pending) {
      pending = this.ask(cwd).finally(() => this.pending.delete(cwd));
      this.pending.set(cwd, pending);
    }
    return pending;
  }

  /** A git that cannot be started gives the folder key, which is not kept: git is asked again. */
  private async ask(cwd: string): Promise<string> {
    try {
      const before = this.cache.get(cwd);
      if (before && (await exists(join(cwd, ".git"))) === this.notRepo.get(cwd)) return before;
      const common = await this.git(commonDirArgs(cwd));
      let key = this.folderKey(cwd);
      if (common.code === 0) {
        const root = rootOf(common.stdout);
        key = this.remoteKey(root, await this.git(remoteArgs(root)));
      }
      this.keep(
        cwd,
        key,
        common.code !== 0,
        common.code !== 0 && (await exists(join(cwd, ".git"))),
      );
      return key;
    } catch {
      return this.folderKey(cwd);
    }
  }

  private keep(cwd: string, key: string, noRepo: boolean, hadGit: boolean): void {
    this.cache.set(cwd, key);
    if (noRepo) this.notRepo.set(cwd, hadGit);
    else this.notRepo.delete(cwd);
  }

  private folderKey(path: string): string {
    return `host:${this.hostId}:${path}`;
  }

  private remoteKey(root: string, remote: GitResult): string {
    return remote.code === 0 ? normalizeRemote(remote.stdout) : this.folderKey(root);
  }
}
