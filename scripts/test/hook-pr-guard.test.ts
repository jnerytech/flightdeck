import { describe, expect, test } from "bun:test";
import { prMergeViolation } from "../lib/claude-hooks.ts";

const session = (command: string) => prMergeViolation(command, {});

describe("hook-pr-guard", () => {
  test("a session's hand merge or tag is blocked and points to auto-merge (#271)", () => {
    for (const command of [
      "bun run pr -- merge 12",
      "bun run pr merge 12",
      "cd ../flightdeck-x && bun run pr -- tag v1.2.3",
      "FLIGHTDECK_COORDINATOR=1 bun run pr -- merge 12",
      "bun scripts/pr-flow.ts merge 12",
      "gh pr merge 12 --merge",
      "gh api -X PUT repos/{owner}/{repo}/pulls/12/merge -f merge_method=merge",
    ]) {
      const reason = session(command) ?? "";
      expect(reason).toContain("the coordinator's");
      expect(reason).toContain("bun run pr -- auto <n>");
    }
  });

  test("open, auto, next and update pass, as do words in a message (#271)", () => {
    for (const command of [
      "bun run pr -- open pr-auto --base flow-pr",
      "bun run pr -- auto 12",
      "bun run pr -- next",
      "bun run pr -- update 12",
      "gh pr view 12",
      "gh api repos/{owner}/{repo}/pulls/12",
      "git commit -m 'docs: bun run pr -- merge is the coordinator'",
      'echo "gh pr merge" > notes.txt',
    ]) {
      expect(session(command)).toBeNull();
    }
  });

  test("the coordinator's own session may merge and tag (#271)", () => {
    const env = { FLIGHTDECK_COORDINATOR: "1" };
    expect(prMergeViolation("bun run pr -- merge 12", env)).toBeNull();
    expect(prMergeViolation("bun run pr -- tag v1.2.3", env)).toBeNull();
  });
});
