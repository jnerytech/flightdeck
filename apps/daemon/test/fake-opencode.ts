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
  }>;
}

export function installFakeOpenCode(): FakeOpenCode {
  const dir = realTempDir("fd-fake-opencode-");
  const log = join(dir, "calls.jsonl");
  const main = join(import.meta.dir, "fake-opencode-main.ts");
  const bun = process.execPath;
  writeFileSync(
    join(dir, "opencode"),
    `#!/bin/sh\nFAKE_OPENCODE_LOG="${log}" exec "${bun}" "${main}" "$@"\n`,
  );
  chmodSync(join(dir, "opencode"), 0o755);
  writeFileSync(
    join(dir, "opencode.cmd"),
    `@echo off\r\nset "FAKE_OPENCODE_LOG=${log}"\r\n"${bun}" "${main}" %*\r\n`,
  );
  return {
    dir,
    path: join(dir, process.platform === "win32" ? "opencode.cmd" : "opencode"),
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
  };
}
