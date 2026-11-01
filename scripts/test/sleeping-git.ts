/**
 * A `git` that is slow to start, as under an antivirus or on a network drive: a folder put first
 * on PATH with a `git` script and a `git.cmd` (Windows) that record the call, wait `delayMs`, and
 * then run the real git. A call that was not made is how a test shows that a path no longer asks
 * git, and how long the call took shows whether the daemon waited for it.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { whichOnPath } from "../../apps/daemon/src/which.ts";

export interface SleepingGit {
  dir: string;
  /** Arguments of every call, in order. */
  calls(): string[][];
  /** Takes the fake off PATH. */
  restore(): void;
}

const MAIN = join(import.meta.dir, "sleeping-git-main.ts");

export function installSleepingGit(
  delayMs: number,
  env: Record<string, string | undefined> = process.env,
): SleepingGit {
  const realGit = whichOnPath("git");
  if (!realGit) throw new Error("no git on PATH to wrap");
  const dir = mkdtempSync(join(tmpdir(), "fd-sleeping-git-"));
  const bun = process.execPath;
  writeFileSync(join(dir, "git"), `#!/bin/sh\nexec "${bun}" "${MAIN}" "${dir}" "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  writeFileSync(
    join(dir, "git.cmd"),
    `@echo off\r\n"${bun}" "${MAIN}" "${dir}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
  );
  writeFileSync(join(dir, "options.json"), JSON.stringify({ delayMs, realGit }));
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === "PATH");
  const saved = new Map(keys.map((k) => [k, env[k]]));
  for (const key of keys.length > 0 ? keys : ["PATH"]) {
    env[key] = [dir, env[key] ?? ""].filter(Boolean).join(delimiter);
  }
  return {
    dir,
    calls: () => {
      const log = join(dir, "calls.jsonl");
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
    },
    restore: () => {
      for (const [key, value] of saved) env[key] = value;
    },
  };
}
