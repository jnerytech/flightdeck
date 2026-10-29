/**
 * Guard against running the real PR CLIs (`gh`, `az`) from tests and smokes. Same idea as the
 * claude guard: a sentinel per name first on PATH (it records the call and exits 99) and every
 * PATH entry holding a real one dropped. A test that needs one installs its own fake in front.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export const GUARDED_CLIS = ["gh", "az"] as const;

const variants = (name: string) => [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`];

export interface CliGuard {
  /** Folder with the sentinel executables, first on PATH. */
  dir: string;
  /** One line per sentinel call. */
  log: string;
  names: readonly string[];
}

export function installCliGuard(
  names: readonly string[] = GUARDED_CLIS,
  env: Record<string, string | undefined> = process.env,
): CliGuard {
  const dir = mkdtempSync(join(tmpdir(), "fd-cli-guard-"));
  const log = join(dir, "calls.log");
  for (const name of names) {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit 99\n`);
    chmodSync(join(dir, name), 0o755);
    writeFileSync(
      join(dir, `${name}.cmd`),
      `@echo off\r\necho ${name} %* >> "${log}"\r\nexit /b 99\r\n`,
    );
  }
  // Windows spells it "Path"; rewrite every casing so children inherit the guarded value.
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === "PATH");
  const current = keys.map((k) => env[k] ?? "").find(Boolean) ?? "";
  const clean = current
    .split(delimiter)
    .filter(
      (entry) =>
        entry && !names.some((name) => variants(name).some((v) => existsSync(join(entry, v)))),
    );
  const guarded = [dir, ...clean].join(delimiter);
  for (const key of keys.length > 0 ? keys : ["PATH"]) env[key] = guarded;
  return { dir, log, names };
}

/** Throws unless every guarded name resolves to its sentinel on the current PATH. */
export function assertCliGuardActive(guard: CliGuard): void {
  for (const name of guard.names) {
    const found = Bun.which(name, { PATH: process.env.PATH ?? "" }) ?? "";
    if (!found.startsWith(guard.dir)) {
      throw new Error(`trava de ${name} inativa: "${name}" resolve para ${found || "(nada)"}`);
    }
  }
}

/** Lines recorded by the sentinels; empty when no guarded CLI was executed. */
export function cliCalls(guard: CliGuard): string[] {
  return existsSync(guard.log) ? readFileSync(guard.log, "utf8").trim().split(/\r?\n/) : [];
}

export function assertNoCliCalls(guard: CliGuard): void {
  const calls = cliCalls(guard);
  if (calls.length > 0) {
    throw new Error(
      `CLI real ou sentinela executada ${calls.length} vez(es): ${calls.join(" | ")}`,
    );
  }
}
