import { describe, expect, test } from "bun:test";
import { parseReviewLog, type ReviewGit, reviewProblem } from "../../lib/pr/review-record.ts";

describe("review record (#1707)", () => {
  test("reads the sha each value of a review trailer names, from the commits of the branch log", () => {
    const log = [
      "\x1eabc1234 no findings\x1d9999999 earlier run",
      "\x1e",
      "\x1edef5678 two lows",
    ].join("\n");
    expect(parseReviewLog(log)).toEqual(["abc1234", "9999999", "def5678"]);
  });

  test("a trailer with no sha, or one that is not lowercase hex of 7 to 40 characters, names nothing", () => {
    const log = "\x1eran fine\n\x1e--output=x ran\n\x1eABC1234 upper\n\x1eabc12 short";
    expect(parseReviewLog(log)).toEqual([]);
  });
});

/** A fake git for `reviewProblem`: the head's tree, the tree of each named commit, the merge base with the base branch, and what merging a named commit onto that merge base gives. */
const fakeGit = (opts: {
  head: string;
  trees: Record<string, string>;
  mergeBase?: string;
  merged?: Record<string, { code: number; tree: string }>;
}) => {
  const calls: string[][] = [];
  const git: ReviewGit = async (args) => {
    calls.push(args);
    if (args[0] === "merge-base")
      return opts.mergeBase ? { code: 0, stdout: `${opts.mergeBase}\n` } : { code: 1, stdout: "" };
    if (args[0] === "merge-tree") {
      const done = opts.merged?.[args.at(-1) ?? ""];
      return done ? { code: done.code, stdout: `${done.tree}\n` } : { code: 128, stdout: "" };
    }
    if (args[0] === "rev-parse") return { code: 0, stdout: `${opts.head}\n` };
    if (args.includes("--end-of-options")) {
      const tree = opts.trees[args.at(-1) ?? ""];
      return tree ? { code: 0, stdout: `${tree}\n` } : { code: 1, stdout: "" };
    }
    return { code: 0, stdout: "\x1eabc1234 ran\n" };
  };
  return { git, calls };
};

const MB = "f".repeat(40);

describe("review record: a merge of the base brings no new review (#3731)", () => {
  test("a head that is the reviewed commit plus a clean merge of main passes: the reviewed commit merged onto the head's merge base gives the head's tree", async () => {
    const { git } = fakeGit({
      head: "merged-tree",
      trees: { abc1234: "reviewed-tree" },
      mergeBase: MB,
      merged: { abc1234: { code: 0, tree: "merged-tree" } },
    });
    expect(await reviewProblem("b", "main", git)).toBeNull();
  });

  test("a commit that changes the branch after the record is refused: the merge gives another tree", async () => {
    const { git } = fakeGit({
      head: "other-tree",
      trees: { abc1234: "reviewed-tree" },
      mergeBase: MB,
      merged: { abc1234: { code: 0, tree: "merged-tree" } },
    });
    expect(await reviewProblem("b", "main", git)).toContain(
      "missing /code-review and /security-review",
    );
  });

  test("a merge that conflicts is no match, even when the tree it prints is the head's", async () => {
    const { git } = fakeGit({
      head: "merged-tree",
      trees: { abc1234: "reviewed-tree" },
      mergeBase: MB,
      merged: { abc1234: { code: 1, tree: "merged-tree" } },
    });
    expect(await reviewProblem("b", "main", git)).toContain("missing");
  });

  test("a head with the reviewed commit's tree passes without a merge", async () => {
    const { git, calls } = fakeGit({ head: "same", trees: { abc1234: "same" } });
    expect([
      await reviewProblem("b", "main", git),
      calls.some((c) => c[0] === "merge-tree"),
    ]).toEqual([null, false]);
  });

  test("the merge is asked for the merge base and the named commit, tree only, with no message text", async () => {
    const { git, calls } = fakeGit({
      head: "merged-tree",
      trees: { abc1234: "reviewed-tree" },
      mergeBase: MB,
      merged: { abc1234: { code: 0, tree: "merged-tree" } },
    });
    await reviewProblem("b", "main", git);
    expect(calls.filter((c) => c[0] === "merge-tree")[0]).toEqual([
      "merge-tree",
      "--write-tree",
      "--no-messages",
      MB,
      "abc1234",
    ]);
  });

  test("no merge base, or a git that cannot merge, is no record", async () => {
    const noBase = fakeGit({ head: "merged-tree", trees: { abc1234: "reviewed-tree" } });
    const noMerge = fakeGit({
      head: "merged-tree",
      trees: { abc1234: "reviewed-tree" },
      mergeBase: MB,
    });
    expect([
      await reviewProblem("b", "main", noBase.git),
      await reviewProblem("b", "main", noMerge.git),
    ]).toEqual([expect.stringContaining("missing"), expect.stringContaining("missing")]);
  });
});
