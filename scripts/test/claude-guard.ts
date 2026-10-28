/**
 * Guard against running the real `claude` from tests and smokes. Puts a sentinel `claude` first
 * on PATH (it records the call and exits 99) and drops every PATH entry that holds a real one,
 * so any code path that falls back to "claude on PATH" is caught instead of executed.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const CLAUDE_NAMES = ["claude", "claude.exe", "claude.cmd", "claude.bat", "claude.ps1"];

export interface ClaudeGuard {
  /** Folder with the sentinel executables, first on PATH. */
  dir: string;
  /** One line per sentinel call. */
  log: string;
}

export function installClaudeGuard(env: Record<string, string | undefined> = process.env): ClaudeGuard {
  const dir = mkdtempSync(join(tmpdir(), "fd-claude-guard-"));
  const log = join(dir, "calls.log");
  writeFileSync(join(dir, "claude"), `#!/bin/sh\necho "claude $*" >> "${log}"\nexit 99\n`);
  chmodSync(join(dir, "claude"), 0o755);
  writeFileSync(join(dir, "claude.cmd"), `@echo off\r\necho claude %* >> "${log}"\r\nexit /b 99\r\n`);

  // Windows spells it "Path"; rewrite every casing so children inherit the guarded value.
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === "PATH");
  const current = keys.map((k) => env[k] ?? "").find(Boolean) ?? "";
  const clean = current
    .split(delimiter)
    .filter((entry) => entry && !CLAUDE_NAMES.some((name) => existsSync(join(entry, name))));
  const guarded = [dir, ...clean].join(delimiter);
  for (const key of keys.length > 0 ? keys : ["PATH"]) env[key] = guarded;
  return { dir, log };
}

/** Lines recorded by the sentinel; empty when `claude` was never executed. */
export function claudeCalls(guard: ClaudeGuard): string[] {
  return existsSync(guard.log) ? readFileSync(guard.log, "utf8").trim().split(/\r?\n/) : [];
}

export function assertNoClaudeCalls(guard: ClaudeGuard): void {
  const calls = claudeCalls(guard);
  if (calls.length > 0) {
    throw new Error(`o claude foi executado ${calls.length} vez(es): ${calls.join(" | ")}`);
  }
}
