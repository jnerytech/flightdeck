/**
 * Guard against running real shell commands from workflow `check` steps in tests and smokes.
 * `FLIGHTDECK_CHECK_GUARD` points to a folder with an allowlist of directories: under it, the
 * daemon's real CheckRunner (apps/daemon/src/workflows/check-runner.ts) only lets through
 * commands whose executable, resolved on the current PATH, lives in one of them, and records
 * every other command instead of handing it to the shell. Only fake commands installed by the
 * test itself (`installFakeCheck`) are allowed.
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "./fake-cli.ts";

export const CHECK_GUARD_ENV = "FLIGHTDECK_CHECK_GUARD";

export interface CheckGuard {
  dir: string;
}

export function installCheckGuard(
  env: Record<string, string | undefined> = process.env,
): CheckGuard {
  const dir = mkdtempSync(join(tmpdir(), "fd-check-guard-"));
  writeFileSync(join(dir, "allowed"), "");
  env[CHECK_GUARD_ENV] = dir;
  return { dir };
}

/** Throws unless the guard is set in the current environment. */
export function assertCheckGuardActive(guard: CheckGuard): void {
  if (process.env[CHECK_GUARD_ENV] !== guard.dir) {
    throw new Error(`trava de check inativa: ${CHECK_GUARD_ENV}=${process.env[CHECK_GUARD_ENV]}`);
  }
}

/** Commands the guard refused (they never reached a shell). */
export function refusedChecks(guard: CheckGuard): string[] {
  const log = join(guard.dir, "refused.log");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/) : [];
}

export function assertNoRefusedChecks(guard: CheckGuard): void {
  const refused = refusedChecks(guard);
  if (refused.length > 0) {
    throw new Error(`check com comando real ${refused.length} vez(es): ${refused.join(" | ")}`);
  }
}

/**
 * A fake command for `check` steps (sh + `.cmd`, first on PATH, like the fake `gh`), allowed by
 * the guard found in `env`.
 */
export function installFakeCheck(
  name: string,
  rules: FakeRule[],
  env: Record<string, string | undefined> = process.env,
): FakeCli {
  const fake = installFakeCli(name, rules, env);
  const guard = env[CHECK_GUARD_ENV];
  if (!guard) throw new Error("trava de check ausente: instale-a antes do comando falso");
  appendFileSync(join(guard, "allowed"), `${fake.dir}\n`);
  return fake;
}
