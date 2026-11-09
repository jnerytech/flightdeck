import { describe, expect, test } from "bun:test";
import { isScanned, type LintFinding, sonarLocal } from "../lib/sonar-local.ts";

/**
 * Issue #1528: the functions over Sonar's complexity limit, found by running its rule locally. The
 * linter and git are fakes: the test reads no file and writes none.
 */

const tracked = [
  "apps/daemon/src/board/board.ts",
  "apps/desktop/src/ui/BoardView.tsx",
  "apps/desktop/src/components/ui/button.tsx",
  "apps/daemon/test/board.test.ts",
  "apps/desktop/test/helpers.tsx",
  "scripts/lib/issue-claim.ts",
  "scripts/e2e/journey.ts",
  "docs/SPEC.md",
  "package.json",
].join("\n");

const finding = (file: string, line: number, from: number): LintFinding => ({
  file,
  line,
  message: `Refactor this function to reduce its Cognitive Complexity from ${from} to the 15 allowed.`,
});

function run(args: string[], found: LintFinding[], ls = tracked) {
  const linted: string[][] = [];
  const lines: string[] = [];
  const done = sonarLocal(args, {
    git: async (git) => ({ code: 0, stdout: git[0] === "ls-files" ? ls : "" }),
    lint: async (files) => {
      linted.push(files);
      return found.filter((f) => files.includes(f.file));
    },
    log: (line) => lines.push(line),
  });
  return { done, linted, lines };
}

describe("sonar-left --local: Sonar's complexity rule over the tracked sources (#1528)", () => {
  test("only what Sonar analyses as source is scanned: no tests, no vendored ui, no docs", () => {
    expect(tracked.split("\n").filter(isScanned)).toEqual([
      "apps/daemon/src/board/board.ts",
      "apps/desktop/src/ui/BoardView.tsx",
      "scripts/lib/issue-claim.ts",
    ]);
    expect(isScanned("scripts/smoke-teleport.ts")).toBe(true);
    expect(isScanned("apps/desktop/src/foo.test.tsx")).toBe(false);
    expect(isScanned("apps/desktop/src-tauri/gen/x.ts")).toBe(false);
  });

  test("each function over the limit is one line with its file, line and numbers, sorted by file and line", async () => {
    const { done, linted, lines } = run(
      [],
      [
        finding("scripts/lib/issue-claim.ts", 134, 22),
        finding("apps/daemon/src/board/board.ts", 2830, 18),
      ],
    );
    expect(await done).toBe(0);
    expect(linted).toEqual([
      [
        "apps/daemon/src/board/board.ts",
        "apps/desktop/src/ui/BoardView.tsx",
        "scripts/lib/issue-claim.ts",
      ],
    ]);
    expect(lines).toEqual([
      "2 functions over 15 (local run of Sonar's S3776 rule; Sonar's own list is `sonar-left`)",
      "CRITICAL typescript:S3776 apps/daemon/src/board/board.ts:2830 Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.",
      "CRITICAL typescript:S3776 scripts/lib/issue-claim.ts:134 Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed.",
    ]);
  });

  test("--path narrows the files that are linted, and nothing over the limit says so", async () => {
    const { done, linted, lines } = run(["--path", "apps/daemon/"], []);
    expect(await done).toBe(0);
    expect(linted).toEqual([["apps/daemon/src/board/board.ts"]]);
    expect(lines).toEqual([
      "0 functions over 15 (local run of Sonar's S3776 rule; Sonar's own list is `sonar-left`)",
    ]);
  });

  test("a linter or git that fails is one line and exit 1, and a hostile path prints as plain text", async () => {
    const lines: string[] = [];
    const broken = await sonarLocal([], {
      git: async () => ({ code: 0, stdout: "scripts/a.ts" }),
      lint: async () => {
        throw new Error("cannot parse\u001b[31m a.ts");
      },
      log: (line) => lines.push(line),
    });
    expect([broken, lines]).toEqual([1, ["sonar-left --local: cannot parse [31m a.ts"]]);
    const noGit: string[] = [];
    expect(
      await sonarLocal([], {
        git: async () => ({ code: 128, stdout: "" }),
        lint: async () => [],
        log: (line) => noGit.push(line),
      }),
    ).toBe(1);
    expect(noGit).toEqual(["sonar-left --local: git could not list the tracked files"]);
    // A right-to-left override in a path: built from its code so the source holds no hidden character.
    const hostile = `scripts/lib/is${String.fromCodePoint(0x202e)}sue-claim.ts`;
    const { done, lines: out } = run([], [finding(hostile, 1, 20)], hostile);
    expect(await done).toBe(0);
    expect(out[1]).toBe(
      "CRITICAL typescript:S3776 scripts/lib/is sue-claim.ts:1 Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.",
    );
  });
});
