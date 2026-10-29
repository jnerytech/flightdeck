/**
 * PATH for the CLI guards: the sentinels first, and no folder from which a real guarded CLI
 * could still be found. A folder that holds one but also other programs (on the GitHub ubuntu
 * runner `gh` lives in /usr/bin, next to `git` and `sh`) is replaced by a stand-in folder with
 * links to everything else in it. Where links to files are not possible (Windows without the
 * privilege), the folder is dropped, as the guards always did.
 */
import { existsSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

function standIn(dir: string, hidden: readonly string[]): string | null {
  if (process.platform === "win32") return null;
  const copy = mkdtempSync(join(tmpdir(), "fd-path-guard-"));
  for (const name of readdirSync(dir)) {
    if (!hidden.includes(name)) symlinkSync(join(dir, name), join(copy, name));
  }
  return copy;
}

export function guardPath(current: string, hidden: readonly string[], sentinels: string): string {
  const entries = current
    .split(delimiter)
    .filter(Boolean)
    .flatMap((entry) => {
      if (!hidden.some((name) => existsSync(join(entry, name)))) return [entry];
      const copy = standIn(entry, hidden);
      return copy ? [copy] : [];
    });
  return [sentinels, ...entries].join(delimiter);
}
