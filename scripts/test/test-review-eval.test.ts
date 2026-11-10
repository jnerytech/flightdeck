import { describe, expect, test } from "bun:test";
import {
  gradeTestReview,
  TEST_REVIEW_CASES,
  type TestReviewCase,
  testReviewArgs,
  testReviewPrompt,
} from "../lib/test-review-eval.ts";

// A missing case is an empty one, so its tests fail by assertion, not by a throw.
const byName = (name: string): TestReviewCase =>
  TEST_REVIEW_CASES.find((c) => c.name === name) ?? { name, commits: [], expect: null };

/** The text of the planted file whose path ends with `suffix`, in any commit of the case. */
function planted(name: string, suffix: string): string {
  const files = byName(name).commits.flatMap((commit) => commit.files);
  return files.find((file) => file.path.endsWith(suffix))?.content ?? "";
}

const TABLE = "| Pair | Finding | Severity | Evidence |\n|---|---|---|---|";

describe("test-review-eval (#1604)", () => {
  test("the cases are the three Khorikov checks and a clean pair", () => {
    expect(TEST_REVIEW_CASES.map((c) => c.name)).toEqual([
      "implementation-detail",
      "managed-mock",
      "leaked-knowledge",
      "clean",
    ]);
    expect(TEST_REVIEW_CASES.map((c) => c.expect === null)).toEqual([false, false, false, true]);
    expect(
      TEST_REVIEW_CASES.map((c) => c.commits.map((commit) => commit.subject.split("(")[0])),
    ).toEqual([
      ["test", "feat"],
      ["test", "feat"],
      ["test", "feat"],
      ["test", "feat"],
    ]);
  });

  test("each bad case's test holds the defect it plants; the clean one asserts literals", () => {
    expect(planted("implementation-detail", ".test.ts")).toContain("expect(calls).toEqual(");
    expect(planted("managed-mock", ".test.ts")).toContain('mock.module("../lib/tq-notes-store.ts"');
    expect(planted("leaked-knowledge", ".test.ts")).toContain(
      ".toBe(Math.round(price * (100 - percent)) / 100)",
    );
    expect(planted("clean", ".test.ts")).toContain('.toBe("hello-world")');
    // The test commit carries the test only: the stub never goes in it (docs/TDD.md).
    expect(
      TEST_REVIEW_CASES.map((c) => c.commits[0]?.files.map((f) => f.path.includes("/test/"))),
    ).toEqual([[true], [true], [true], [true]]);
  });

  test("a bad case passes on a row that names its file and one of its words", () => {
    const want = { file: "scripts/test/tq-cart.test.ts", words: ["implementation"] };
    const good = `${TABLE}\n| tq-cart | Implementation details: asserts the call order | medium | tq-cart.test.ts:8 |`;
    expect(gradeTestReview(want, good)).toBe(true);
    const otherFile = `${TABLE}\n| tq-x | Implementation details | medium | tq-slug.test.ts:8 |`;
    expect(gradeTestReview(want, otherFile)).toBe(false);
    const otherWord = `${TABLE}\n| tq-cart | Passes on the stub | high | tq-cart.test.ts:8 |`;
    expect(gradeTestReview(want, otherWord)).toBe(false);
  });

  test("a case that wants high passes only when the same row says high", () => {
    const want = { file: "tq-discount.test.ts", words: ["domain knowledge"], high: true };
    const high = `${TABLE}\n| d | Leaked domain knowledge | high | tq-discount.test.ts:6 |`;
    const medium = `${TABLE}\n| d | Leaked domain knowledge | medium | tq-discount.test.ts:6 |`;
    expect(gradeTestReview(want, high)).toBe(true);
    expect(gradeTestReview(want, medium)).toBe(false);
  });

  test("a clean case passes on a review with no high row, and fails on a high row or no review", () => {
    expect(gradeTestReview(null, "Nothing found. Pairs read: tq-slug. **accept**")).toBe(true);
    expect(
      gradeTestReview(null, `${TABLE}\n| s | Hidden wait | low | tq-slug.test.ts:3 |\n**accept**`),
    ).toBe(true);
    expect(
      gradeTestReview(null, `${TABLE}\n| s | Passes on the stub | high | tq-slug.test.ts:3 |`),
    ).toBe(false);
    expect(gradeTestReview(null, "Credit balance is too low")).toBe(false);
  });

  test("the prompt carries the commits and says not to run git", () => {
    const prompt = testReviewPrompt("abc1234", "commit 1\n\ntest(tq-slug): x\n");
    expect(prompt).toContain("against the base abc1234");
    expect(prompt).toContain("do not run git");
    expect(prompt).toContain("test(tq-slug): x");
  });

  test("the session is the agent, may run only the case's test, and gets no git, Edit or Write", () => {
    const args = testReviewArgs(
      "p",
      { model: "sonnet", budget: "0.5" },
      { dir: "/tmp/fd-x", home: "/home/me" },
      "scripts/test/tq-slug.test.ts",
    );
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after("--agent")).toBe("test-quality-reviewer");
    expect(after("--max-budget-usd")).toBe("0.5");
    const allowed = args.slice(
      args.indexOf("--allowedTools") + 1,
      args.indexOf("--disallowedTools"),
    );
    expect(allowed).toEqual([
      "Read(./**)",
      "Bash(bun --config=bunfig.area.toml test scripts/test/tq-slug.test.ts)",
      "Bash(env -u CLAUDECODE bun --config=bunfig.area.toml test scripts/test/tq-slug.test.ts)",
    ]);
    const denied = args.slice(args.indexOf("--disallowedTools") + 1);
    expect(denied).toContain("Bash(git *)");
    expect(denied).toContain("Edit");
    expect(denied).toContain("Write");
    expect(denied).toContain("Read(~/**)");
  });
});
