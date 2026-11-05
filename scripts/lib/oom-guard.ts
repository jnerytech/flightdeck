/**
 * The OOM killer's first choice (issue #247): a command the slot or the light lane runs, and every
 * `bun test` (the preload), offers itself to the kernel with `oom_score_adj` 1000, so a leaking test
 * is killed before any Claude session (which stays at 0). It writes `/proc/self` before anything is
 * spawned, so every child inherits it at fork, with no race.
 */

/** The highest score: the kernel kills these processes before any other. */
export const OOM_SCORE_ADJ = 1000;

export interface OomDeps {
  platform: NodeJS.Platform;
  write(path: string, data: string): void;
}

/** Raises this process's OOM score on Linux; elsewhere, or when /proc refuses, it does nothing. */
export function offerToOomKiller(deps: OomDeps): boolean {
  if (deps.platform !== "linux") return false;
  try {
    deps.write("/proc/self/oom_score_adj", String(OOM_SCORE_ADJ));
    return true;
  } catch {
    // A /proc that refuses (read-only, a container) must not stop the command.
    return false;
  }
}
