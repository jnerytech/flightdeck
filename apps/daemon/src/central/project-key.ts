import { basename, dirname, resolve } from "node:path";
import { whichOnPath } from "../which.ts";

export type GitRunner = (args: string[]) => { code: number; stdout: string };

const runGit: GitRunner = (args) => {
  const proc = Bun.spawnSync([whichOnPath("git") ?? "git", ...args], {
    env: process.env,
    stdout: "pipe",
    stderr: "ignore",
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString() };
};

/**
 * `git@github.com:Acme/Repo.git`, `https://github.com/acme/repo` and `ssh://git@github.com:22/…`
 * all become `github.com/acme/repo`: no scheme, user, port, trailing `.git`, in lowercase.
 */
export function normalizeRemote(url: string): string {
  const trimmed = url.trim();
  const scp = /^[^/@]+@([^:/]+):(.+)$/.exec(trimmed);
  const path =
    scp && !trimmed.includes("://")
      ? `${scp[1]}/${scp[2]}`
      : trimmed
          .replace(/^[a-z+]+:\/\//i, "")
          .replace(/^[^@/]+@/, "")
          .replace(/^([^/:]+):\d+\//, "$1/");
  return path
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

/**
 * Groups sessions by project: the normalized `remote.origin.url` of the repository holding the
 * cwd (worktrees count as their main repository), else `host:<hostId>:<repository root>`, else
 * `host:<hostId>:<cwd>`. Cached per cwd.
 */
export class ProjectKeys {
  private readonly cache = new Map<string, string>();

  constructor(
    readonly hostId: string,
    private readonly git: GitRunner = runGit,
  ) {}

  keyFor(cwd: string): string {
    const cached = this.cache.get(cwd);
    if (cached) return cached;
    const key = this.compute(cwd);
    this.cache.set(cwd, key);
    return key;
  }

  private compute(cwd: string): string {
    // The common dir is the main repository's .git, also from inside a worktree.
    const common = this.git(["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (common.code !== 0) return `host:${this.hostId}:${cwd}`;
    const dir = resolve(common.stdout.trim());
    const root = basename(dir) === ".git" ? dirname(dir) : dir;
    const remote = this.git(["-C", root, "config", "--get", "remote.origin.url"]);
    return remote.code === 0 ? normalizeRemote(remote.stdout) : `host:${this.hostId}:${root}`;
  }
}
