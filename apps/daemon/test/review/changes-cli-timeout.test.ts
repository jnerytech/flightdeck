import { describe, expect, test } from "bun:test";
import { TIMEOUT_MS as COMMIT_RUNS_FOR_MS } from "../../src/review/commit-files.ts";
import { timeoutOf } from "../../src/review/domain/changes-cli-view.ts";

describe("how long a changes verb waits for the daemon (#3620)", () => {
  test("a commit waits at least as long as the daemon lets its hooks run, and a pr longer, for it pushes", () => {
    expect(timeoutOf("commit")).toBeGreaterThan(COMMIT_RUNS_FOR_MS);
    expect(timeoutOf("pr")).toBeGreaterThan(timeoutOf("commit"));
  });

  test("the reads and the revert answer at once, so they keep the short wait", () => {
    for (const action of ["get", "sessions", "watch", "revert", "undo-revert"] as const)
      expect(timeoutOf(action)).toBe(15_000);
  });
});
