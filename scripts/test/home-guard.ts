/**
 * Guard against reading the real `~/.claude` from tests and smokes (transcripts may hold secrets
 * and private paths). Points every home variable at a throwaway folder with an empty
 * `.claude/projects`, so `~` (resolved from the current environment) never reaches the real one.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative } from "node:path";
import { expandHome } from "../../apps/daemon/src/config.ts";
import { realTempDir } from "./temp-dir.ts";

export interface HomeGuard {
  /** Fake home, now in HOME/USERPROFILE. */
  dir: string;
  /** The `~/.claude` of the real user, which nothing may resolve to. */
  realClaude: string;
}

const inside = (root: string, path: string) => {
  const rel = relative(root.toLowerCase(), path.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export function installHomeGuard(env: Record<string, string | undefined> = process.env): HomeGuard {
  const realClaude = join(homedir(), ".claude");
  const dir = realTempDir("fd-home-guard-");
  mkdirSync(join(dir, ".claude", "projects"), { recursive: true });
  env.HOME = dir;
  env.USERPROFILE = dir;
  if (process.platform === "win32") {
    const { root } = parse(dir);
    env.HOMEDRIVE = root.slice(0, 2);
    env.HOMEPATH = dir.slice(2);
  }
  const guard = { dir, realClaude };
  assertHomeGuard(guard);
  return guard;
}

/** Throws unless `~` (both `os.homedir()` and the daemon's `expandHome`) lands on the fake home. */
export function assertHomeGuard(guard: HomeGuard): void {
  for (const [what, path] of [
    ["os.homedir()", homedir()],
    ['expandHome("~/.claude")', expandHome("~/.claude")],
  ] as const) {
    if (!inside(guard.dir, path) || inside(guard.realClaude, path)) {
      throw new Error(`trava de home inativa: ${what} resolve para ${path}`);
    }
  }
}
