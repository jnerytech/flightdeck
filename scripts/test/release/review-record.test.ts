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

/** A fake git for `reviewProblem`: the head's tree, the tree of each named commit, the trailers, and the branch-side diff of each range. */
const fakeGit = (opts: {
  head: string;
  trees: Record<string, string>;
  diffs: Record<string, string>;
  reviewed?: string;
}) => {
  const calls: string[][] = [];
  const git: ReviewGit = async (args) => {
    calls.push(args);
    if (args[0] === "diff") return { code: 0, stdout: opts.diffs[args.at(-2) ?? ""] ?? "" };
    if (args[0] === "rev-parse") return { code: 0, stdout: `${opts.head}\n` };
    if (args.includes("--end-of-options")) {
      const tree = opts.trees[args.at(-1) ?? ""];
      return tree ? { code: 0, stdout: `${tree}\n` } : { code: 1, stdout: "" };
    }
    return { code: 0, stdout: `\x1e${opts.reviewed ?? "abc1234"} ran\n` };
  };
  return { git, calls };
};

const diffOf = (file: string, line: string, at = 10, index = "1111111..2222222") =>
  [
    `diff --git a/${file} b/${file}`,
    `index ${index} 100644`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${at},2 +${at},3 @@ function f() {`,
    " keep",
    `+${line}`,
    "",
  ].join("\n");

describe("review record: a merge of the base brings no new review (#3731)", () => {
  const reviewedRange = "origin/main...abc1234";
  const headRange = "origin/main...origin/b";

  test("a head that is the reviewed commit plus a merge of main passes: the branch-side change is the same, whatever main moved around it", async () => {
    const { git } = fakeGit({
      head: "merged-tree",
      trees: { abc1234: "reviewed-tree" },
      diffs: {
        [reviewedRange]: diffOf("a.ts", "added", 10, "1111111..2222222"),
        [headRange]: diffOf("a.ts", "added", 42, "3333333..2222222"),
      },
    });
    expect(await reviewProblem("b", "main", git)).toBeNull();
  });

  test("a commit that changes the branch after the record is refused, and so is a conflict resolved on a line the branch changed", async () => {
    const { git } = fakeGit({
      head: "other-tree",
      trees: { abc1234: "reviewed-tree" },
      diffs: {
        [reviewedRange]: diffOf("a.ts", "added"),
        [headRange]: diffOf("a.ts", "added and then edited"),
      },
    });
    expect(await reviewProblem("b", "main", git)).toContain(
      "missing /code-review and /security-review",
    );
  });

  test("a new file on the branch's side after the record is refused", async () => {
    const { git } = fakeGit({
      head: "other-tree",
      trees: { abc1234: "reviewed-tree" },
      diffs: {
        [reviewedRange]: diffOf("a.ts", "added"),
        [headRange]: diffOf("a.ts", "added") + diffOf("b.ts", "new"),
      },
    });
    expect(await reviewProblem("b", "main", git)).toContain("missing");
  });

  test("a head with the reviewed commit's tree passes without comparing diffs", async () => {
    const { git, calls } = fakeGit({
      head: "same",
      trees: { abc1234: "same" },
      diffs: {},
    });
    expect([await reviewProblem("b", "main", git), calls.some((c) => c[0] === "diff")]).toEqual([
      null,
      false,
    ]);
  });

  test("the diff carries binary content and no rename guess, so a changed binary or a moved file cannot look the same", async () => {
    const { git, calls } = fakeGit({
      head: "merged-tree",
      trees: { abc1234: "reviewed-tree" },
      diffs: {},
    });
    await reviewProblem("b", "main", git);
    const flags = calls
      .filter((c) => c[0] === "diff")
      .map((c) => c.filter((a) => a.startsWith("--")));
    expect(flags[0]).toEqual(expect.arrayContaining(["--binary", "--no-renames"]));
  });

  test("a diff git cannot print, or a commit that is no commit, is no record", async () => {
    const broken: ReviewGit = async (args) =>
      args[0] === "diff"
        ? { code: 128, stdout: "" }
        : args[0] === "rev-parse"
          ? { code: 0, stdout: "merged-tree\n" }
          : args.includes("--end-of-options")
            ? { code: 0, stdout: "reviewed-tree\n" }
            : { code: 0, stdout: "\x1eabc1234 ran\n" };
    expect(await reviewProblem("b", "main", broken)).toContain("missing");
  });
});
