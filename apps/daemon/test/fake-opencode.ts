/**
 * Phase 39: a fake `opencode` for daemon tests and smoke:opencode: a folder to put first on PATH
 * with an `opencode` script and an `opencode.cmd`, both forwarding to fake-opencode-main.ts with the
 * running Bun. What it ran is read back from its log (see fake-opencode-main.ts).
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";

export interface FakeOpenCode {
  /** The folder to put first on PATH. */
  dir: string;
  /** The `opencode` (or `opencode.cmd`) to name in config. */
  path: string;
  /** What it ran, in order. */
  calls(): Array<{
    args: string[];
    cwd: string;
    disableProjectConfig: string | null;
    hasConfigContent: boolean;
    session: string | null;
    /** A request a `serve` got (`GET <route>`): whether it carried the password. */
    authorized?: boolean;
  }>;
  /** The ACP requests it got, in order: the method, and a prompt's text. */
  acp(): Array<{ method: string; text?: string }>;
}

export function installFakeOpenCode(): FakeOpenCode {
  const dir = realTempDir("fd-fake-opencode-");
  const log = join(dir, "calls.jsonl");
  const acpLog = join(dir, "acp.jsonl");
  const main = join(import.meta.dir, "fake-opencode-main.ts");
  const bun = process.execPath;
  writeFileSync(
    join(dir, "opencode"),
    `#!/bin/sh\nFAKE_OPENCODE_LOG="${log}" FAKE_OPENCODE_ACP_LOG="${acpLog}" exec "${bun}" "${main}" "$@"\n`,
  );
  chmodSync(join(dir, "opencode"), 0o755);
  writeFileSync(
    join(dir, "opencode.cmd"),
    `@echo off\r\nset "FAKE_OPENCODE_LOG=${log}"\r\nset "FAKE_OPENCODE_ACP_LOG=${acpLog}"\r\n"${bun}" "${main}" %*\r\n`,
  );
  return {
    acp: () => readLines(acpLog),
    dir,
    path: join(dir, process.platform === "win32" ? "opencode.cmd" : "opencode"),
    calls: () => readLines(log),
  };
}

/** The JSON lines of a log the fake writes; none before it ran. */
function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
