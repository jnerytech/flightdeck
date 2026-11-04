/**
 * Fake CLIs (`gh`, `az`) for tests and smokes: a folder put first on PATH with a `name` script
 * and a `name.cmd` (Windows), both forwarding to fake-cli-main.ts. Every call is recorded; the
 * answers come from rules that can be swapped while the fake is installed (to simulate a merge).
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface FakeRule {
  /** Every one of these must appear among the arguments. */
  args: string[];
  /** Every one of these must appear inside some argument (a GraphQL query or a variable). */
  contains?: string[];
  /** Only answers the n-th call of the fake (1-based), to fail once and then pass. */
  call?: number;
  stdout?: string;
  /** What the fake writes to stderr (a login's one-time code, an error message). */
  stderr?: string;
  code?: number;
  /** Holds the process this long after it wrote its output, like a login waiting for the browser. */
  delayMs?: number;
  /**
   * Leaves a child behind that keeps stdout and stderr open for this long, like the `bun` a Windows
   * `.cmd` shim starts: ending the shim does not close the pipes.
   */
  holdPipesMs?: number;
}

export interface FakeCli {
  dir: string;
  /** Arguments of every call, in order. */
  calls(): string[][];
  /** Working directory of every call, in the same order. */
  cwds(): string[];
  respond(rules: FakeRule[]): void;
  /** Takes the fake off PATH. */
  restore(): void;
}

const MAIN = join(import.meta.dir, "fake-cli-main.ts");

export interface FakeCliOptions {
  /**
   * Refuses, like Bun does for a Windows .cmd shim, an argument with a newline or one of
   * `< > & | ^ "` or `%`, before recording the call. On by default for every fake (`gh` and `az` are .cmd shims on Windows),
   * so the refusal shows on every platform the suite runs on.
   */
  rejectCmdChars?: boolean;
}

export function installFakeCli(
  name: string,
  rules: FakeRule[],
  env: Record<string, string | undefined> = process.env,
  options: FakeCliOptions = {},
): FakeCli {
  const dir = mkdtempSync(join(tmpdir(), `fd-fake-${name}-`));
  const bun = process.execPath;
  writeFileSync(join(dir, name), `#!/bin/sh\nexec "${bun}" "${MAIN}" "${dir}" "$@"\n`);
  chmodSync(join(dir, name), 0o755);
  writeFileSync(
    join(dir, `${name}.cmd`),
    `@echo off\r\n"${bun}" "${MAIN}" "${dir}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
  );
  const respond = (next: FakeRule[]) =>
    writeFileSync(join(dir, "rules.json"), JSON.stringify(next));
  respond(rules);
  writeFileSync(
    join(dir, "options.json"),
    JSON.stringify({ rejectCmdChars: options.rejectCmdChars ?? true }),
  );

  const keys = Object.keys(env).filter((k) => k.toUpperCase() === "PATH");
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
    cwds: () => {
      const log = join(dir, "cwds.jsonl");
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string);
    },
    respond,
    // Takes out only this fake's folder, so the order of several restores does not matter.
    restore: () => {
      for (const key of keys.length > 0 ? keys : ["PATH"]) {
        const rest = (env[key] ?? "").split(delimiter).filter((entry) => entry !== dir);
        env[key] = rest.join(delimiter);
      }
    },
  };
}
