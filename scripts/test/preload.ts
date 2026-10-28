// Loaded before every test file (bunfig `preload`): no test may run the real `claude` nor read
// the real `~/.claude`.
import { afterAll } from "bun:test";
import { assertNoClaudeCalls, installClaudeGuard } from "./claude-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./home-guard.ts";

const guard = installClaudeGuard();
const home = installHomeGuard();

// `Bun.which(name)` without options keeps the PATH the process started with; code must pass the
// current one. Make sure that lookup now lands on the sentinel, or stop before any test runs.
const found = Bun.which("claude", { PATH: process.env.PATH ?? "" }) ?? "";
if (!found.startsWith(guard.dir)) {
  throw new Error(`trava do claude inativa: "claude" resolve para ${found || "(nada)"}`);
}

afterAll(() => {
  assertNoClaudeCalls(guard);
  // A test that put the real home back would have let the indexer reach the real transcripts.
  assertHomeGuard(home);
});
