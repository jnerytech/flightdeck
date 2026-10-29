// Loaded before every test file (bunfig `preload`): no test may run the real `claude`, `gh` or
// `az`, nor a real shell command from a workflow `check`, nor read the real `~/.claude`.
import { afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCheckGuardActive, assertNoRefusedChecks, installCheckGuard } from "./check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./home-guard.ts";

// CLI sentinels first, so the claude one ends up first on PATH (tests rely on that).
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
// The real service controller (systemctl, schtasks, loginctl) only records attempts here.
const serviceGuard = join(mkdtempSync(join(tmpdir(), "fd-service-guard-")), "calls.log");
process.env.FLIGHTDECK_SERVICE_GUARD = serviceGuard;
const checks = installCheckGuard();

// `Bun.which(name)` without options keeps the PATH the process started with; code must pass the
// current one. Make sure that lookup now lands on the sentinel, or stop before any test runs.
const found = Bun.which("claude", { PATH: process.env.PATH ?? "" }) ?? "";
if (!found.startsWith(guard.dir)) {
  throw new Error(`trava do claude inativa: "claude" resolve para ${found || "(nada)"}`);
}
assertCliGuardActive(clis);
assertCheckGuardActive(checks);

afterAll(() => {
  assertNoClaudeCalls(guard);
  // A fake `gh`/`az` installed by a test sits in front of the sentinel; reaching the sentinel
  // means some code ran the CLI without one.
  assertNoCliCalls(clis);
  // The real CheckRunner only reaches the shell for fake commands installed by the tests.
  assertNoRefusedChecks(checks);
  // A test that put the real home back would have let the indexer reach the real transcripts.
  assertHomeGuard(home);
  if (existsSync(serviceGuard)) {
    throw new Error(`controlador de serviço real chamado: ${readFileSync(serviceGuard, "utf8")}`);
  }
});
