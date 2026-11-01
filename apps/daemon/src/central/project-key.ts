import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { whichOnPath } from "../which.ts";

export type GitResult = { code: number; stdout: string };
export type GitRunner = (args: string[]) => GitResult;
/** The same without waiting for the process: the event loop keeps serving while git runs. */
export type AsyncGitRunner = (args: string[]) => Promise<GitResult>;

const runGit: GitRunner = (args) => {
  const proc = Bun.spawnSync([whichOnPath("git") ?? "git", ...args], {
    env: process.env,
    stdout: "pipe",
    stderr: "ignore",
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString() };
};

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
 * `resolve` and `lookup` ask git without waiting for the process, so a git that starts slowly
 * (antivirus, a network drive) does not stop the daemon from serving its clients; `keyFor` waits
 * for it and is for the places that need the answer on the spot.
 */
export class ProjectKeys {
  private readonly cache = new Map<string, string>();
  /** The cwds cached with a folder key because git found no repository: whether `.git` existed then. */
  private readonly notRepo = new Map<string, boolean>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    readonly hostId: string,
    private readonly git: GitRunner = runGit,
    private readonly gitAsync: AsyncGitRunner = runGitAsync,
  ) {}

  keyFor(cwd: string): string {
    const cached = this.cached(cwd);
    if (cached) return cached;
    const common = this.git(commonDirArgs(cwd));
    let key = this.folderKey(cwd);
    if (common.code === 0) {
      const root = rootOf(common.stdout);
      key = this.remoteKey(root, this.git(remoteArgs(root)));
    }
    this.keep(cwd, key, common.code !== 0);
    return key;
  }

  /**
   * The cached key. A folder key that git gave for a folder with no repository is dropped when the
   * folder has a `.git` now, which it did not have then: it became a repository, and git is asked
   * again.
   */
  private cached(cwd: string): string | undefined {
    const key = this.cache.get(cwd);
    if (key && this.notRepo.has(cwd) && existsSync(join(cwd, ".git")) !== this.notRepo.get(cwd)) {
      this.cache.delete(cwd);
      this.notRepo.delete(cwd);
      return undefined;
    }
    return key;
  }

  private keep(cwd: string, key: string, noRepo: boolean): void {
    this.cache.set(cwd, key);
    if (noRepo) this.notRepo.set(cwd, existsSync(join(cwd, ".git")));
    else this.notRepo.delete(cwd);
  }

  /** The key without blocking: the cached one, else a promise of it. */
  lookup(cwd: string): string | Promise<string> {
    return this.cached(cwd) ?? this.resolve(cwd);
  }

  /** The key, asking git without blocking the event loop; asked once per cwd, then cached. */
  resolve(cwd: string): Promise<string> {
    const cached = this.cached(cwd);
    if (cached) return Promise.resolve(cached);
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
      const common = await this.gitAsync(commonDirArgs(cwd));
      let key = this.folderKey(cwd);
      if (common.code === 0) {
        const root = rootOf(common.stdout);
        key = this.remoteKey(root, await this.gitAsync(remoteArgs(root)));
      }
      this.keep(cwd, key, common.code !== 0);
      return key;
    } catch {
      return this.folderKey(cwd);
    }
  }

  private folderKey(path: string): string {
    return `host:${this.hostId}:${path}`;
  }

  private remoteKey(root: string, remote: GitResult): string {
    return remote.code === 0 ? normalizeRemote(remote.stdout) : this.folderKey(root);
  }
}
