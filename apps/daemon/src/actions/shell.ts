/**
 * Phase 17: how a free command (`run_with_secret`) reaches a shell. The command is Claude's own
 * line, so it is the one place where a shell is wanted; the secrets are in the environment, never
 * in the line. On Windows the line goes to a temporary `.cmd`: `cmd /c` takes it from the argument
 * list with its quotes escaped for the C runtime, which cmd does not undo.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ShellLine {
  argv: string[];
  /** Removes whatever had to be written for the line to run. */
  cleanup(): void;
}

export function shellLine(command: string, platform: NodeJS.Platform): ShellLine {
  if (platform !== "win32") return { argv: ["sh", "-c", command], cleanup: () => {} };
  const folder = mkdtempSync(join(tmpdir(), "fd-shell-"));
  const file = join(folder, "cmd.cmd");
  writeFileSync(file, `@echo off\r\n${command}\r\n`);
  return {
    argv: ["cmd", "/d", "/c", file],
    cleanup: () => rmSync(folder, { recursive: true, force: true }),
  };
}
