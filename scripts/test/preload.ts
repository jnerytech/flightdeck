// Loaded before every test file (bunfig `preload`): no test may run the real `claude`, `gh` or
// `az`, nor read the real `~/.claude`.
import { afterAll } from "bun:test";
import { assertNoClaudeCalls, installClaudeGuard } from "./claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./home-guard.ts";

// CLI sentinels first, so the claude one ends up first on PATH (tests rely on that).
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();

// `Bun.which(name)` without options keeps the PATH the process started with; code must pass the
// current one. Make sure that lookup now lands on the sentinel, or stop before any test runs.
const found = Bun.which("claude", { PATH: process.env.PATH ?? "" }) ?? "";
if (!found.startsWith(guard.dir)) {
  throw new Error(`trava do claude inativa: "claude" resolve para ${found || "(nada)"}`);
}
assertCliGuardActive(clis);

afterAll(() => {
  assertNoClaudeCalls(guard);
  // A fake `gh`/`az` installed by a test sits in front of the sentinel; reaching the sentinel
  // means some code ran the CLI without one.
  assertNoCliCalls(clis);
  // A test that put the real home back would have let the indexer reach the real transcripts.
  assertHomeGuard(home);
});
