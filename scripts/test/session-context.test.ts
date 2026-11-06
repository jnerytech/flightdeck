import { describe, expect, test } from "bun:test";
import { gatherFacts, type SessionFacts, sessionContext } from "../lib/session-context.ts";

const HEAD = "f".repeat(40);
const BASE = "b".repeat(40);

/** A fake git on branch `fix-x`, 3 commits past the merge-base with origin/main. */
const git =
  (branch = "fix-x") =>
  (args: string[]) => {
    const key = args.join(" ");
    if (key === "rev-parse --abbrev-ref HEAD") return `${branch}\n`;
    if (key === "rev-parse HEAD") return `${HEAD}\n`;
    if (key === "merge-base HEAD origin/main") return `${BASE}\n`;
    if (key === `rev-list --count ${BASE}..HEAD`) return "3\n";
    if (key === `log --format=%H%x1f%s ${BASE}..HEAD`) {
      return `1\x1ftest(board-map): red\n2\x1ffeat(board-map): green\n3\x1ftest(board-pull): red`;
    }
    return null;
  };

const holder = JSON.stringify({
  pid: 42,
  label: "fd-ux",
  command: "bun run demo:shots",
  startedAt: 1_000,
});

describe("session-context", () => {
  test("the facts come from git and the slot's lock file", () => {
    expect(gatherFacts(git(), holder, 61_000)).toEqual({
      branch: "fix-x",
      ahead: 3,
      tested: ["board-map", "board-pull"],
      slot: { pid: 42, label: "fd-ux", command: "bun run demo:shots", startedAt: 1_000 },
      now: 61_000,
    });
  });

  test("no git and no lock give empty facts, never an error", () => {
    expect(gatherFacts(() => null, null, 5)).toEqual({
      branch: null,
      ahead: null,
      tested: [],
      slot: null,
      now: 5,
    });
  });

  const facts: SessionFacts = {
    branch: "fix-x",
    ahead: 3,
    tested: ["board-map", "board-pull"],
    slot: null,
    now: 0,
  };

  test("at startup it names the branch, the commits, the tested scopes and the free slot", () => {
    const text = sessionContext("startup", facts);
    expect(text).toContain("branch fix-x, 3 commit(s) past main");
    expect(text).toContain("test(scope) commits so far: board-map, board-pull");
    expect(text).toContain("slot: free");
    expect(text).not.toContain("compact");
  });

  test("after a compact it says the path rules come back only with a matching file", () => {
    const text = sessionContext("compact", { ...facts, slot: JSON.parse(holder), now: 61_000 });
    expect(text).toContain(".claude/rules");
    expect(text).toContain("after this compact");
    expect(text).toContain("slot: fd-ux: bun run demo:shots (pid 42, 1m 0s)");
  });

  test("on main it points dev work to a worktree, and with no facts it says nothing", () => {
    expect(sessionContext("startup", { ...facts, branch: "main", ahead: 0, tested: [] })).toContain(
      "cd ../flightdeck-<topic> && claude",
    );
    expect(
      sessionContext("resume", { branch: null, ahead: null, tested: [], slot: null, now: 0 }),
    ).toBe("");
  });
});
