import { describe, expect, test } from "bun:test";
import type { FileChange } from "../../lib/guards/structure-guard.ts";
import { countTests, removalVerdict, runTestsRemoved } from "../../lib/guards/tests-removed.ts";

const FILE = "apps/desktop/test/visual-direction/cabecalho.test.tsx";
const IMPORTS = 'import { expect, test } from "bun:test";\n';

const FULL = [
  IMPORTS,
  'describe("header", () => {',
  '  test("a title", () => {',
  "    expect(title()).toBe(1);",
  "    expect(size()).toBe(2);",
  "  });",
  '  it("a tab", () => expect(tab()).toBe(3));',
  '  test.each([1, 2])("row %d", (n) => { expect(row(n)).toBeTruthy(); });',
  '  test.skipIf(process.platform === "win32")("a path", () => { expect(path()).toBe("/"); });',
  "});",
].join("\n");

/** What a bad conflict resolution leaves: the imports only (#2154). */
const CUT = IMPORTS;

function input(
  changes: FileChange[],
  base: Record<string, string>,
  head: Record<string, string>,
  messages: string[] = ["chore(desktop): merge main into the branch"],
) {
  return {
    changes,
    messages,
    before: (path: string) => base[path] ?? null,
    after: (path: string) => head[path] ?? null,
  };
}

const CUT_LINE = `${FILE}: 4 tests, 5 expects at the base; 0 tests, 0 expects at the head`;

describe("tests-removed (#2176)", () => {
  test("counts tests (test, it, each, skipIf) and expects, not describe or expect.assertions", () => {
    expect(countTests(FULL)).toEqual({ tests: 4, expects: 5 });
    expect(
      countTests(
        "describe('x', () => { expect.assertions(1); split(a); fit; res.expect(200); unexpect(1); });",
      ),
    ).toEqual({
      tests: 0,
      expects: 0,
    });
  });

  test("a net diff that cuts a test file to its imports fails and names its counts", () => {
    const verdict = removalVerdict(
      input([{ status: "M", path: FILE }], { [FILE]: FULL }, { [FILE]: CUT }),
    );
    expect(verdict).toEqual({ problems: [CUT_LINE], waived: [] });
  });

  test("a trailer naming the file with a reason waives it and keeps the reason", () => {
    const why = "the tests moved to layout-abas";
    const messages = [
      `test(layout): one place for the tabs (#1)\n\nTests-Removed: ${FILE} — ${why}\nCo-Authored-By: x`,
    ];
    const verdict = removalVerdict(
      input([{ status: "M", path: FILE }], { [FILE]: FULL }, { [FILE]: CUT }, messages),
    );
    expect(verdict).toEqual({ problems: [], waived: [`${CUT_LINE} (waived: ${why})`] });
  });

  test("a trailer naming another file, no path or no reason waives nothing", () => {
    const trailers = [
      "Tests-Removed: apps/desktop/test/other.test.tsx — moved",
      "Tests-Removed: — moved",
      `Tests-Removed: ${FILE} —`,
      `Tests-Removed: ${FILE}`,
    ];
    const verdicts = trailers.map((trailer) =>
      removalVerdict(
        input([{ status: "M", path: FILE }], { [FILE]: FULL }, { [FILE]: CUT }, [
          `x\n\n${trailer}`,
        ]),
      ),
    );
    expect(verdicts).toEqual(trailers.map(() => ({ problems: [CUT_LINE], waived: [] })));
  });

  test("one trailer may name several files; each file it names is waived, the rest still fail", () => {
    const other = "apps/daemon/test/board/cards.test.ts";
    const third = "scripts/test/x.test.ts";
    const changes: FileChange[] = [
      { status: "M", path: FILE },
      { status: "D", path: other },
      { status: "M", path: third },
    ];
    const base = { [FILE]: FULL, [other]: FULL, [third]: FULL };
    const verdict = removalVerdict(
      input(changes, base, { [FILE]: CUT, [third]: CUT }, [
        `x\n\nTests-Removed: ${FILE}, ${other} — merged into one file`,
      ]),
    );
    expect(verdict).toEqual({
      problems: [`${third}: 4 tests, 5 expects at the base; 0 tests, 0 expects at the head`],
      waived: [
        `${CUT_LINE} (waived: merged into one file)`,
        `${other}: 4 tests, 5 expects at the base; deleted (waived: merged into one file)`,
      ],
    });
  });

  test("a rename with the same tests, a file that gains tests or keeps its counts, an added file or a non-test file passes; one expect lost fails", () => {
    const to = "apps/desktop/test/layout/cabecalho.test.tsx";
    const changes: FileChange[] = [
      { status: "R", path: to, from: FILE },
      { status: "M", path: "apps/desktop/test/a.test.ts" },
      { status: "A", path: "apps/desktop/test/b.test.ts" },
      { status: "M", path: "apps/desktop/src/a.ts" },
      { status: "M", path: "apps/desktop/test/c.test.ts" },
    ];
    const base = {
      [FILE]: FULL,
      "apps/desktop/test/a.test.ts": FULL,
      "apps/desktop/src/a.ts": FULL,
      "apps/desktop/test/c.test.ts": FULL,
    };
    const head = {
      [to]: FULL.replace("header", "the header"),
      "apps/desktop/test/a.test.ts": `${FULL}\ntest("more", () => expect(1).toBe(1));`,
      "apps/desktop/test/b.test.ts": FULL,
      "apps/desktop/src/a.ts": CUT,
      "apps/desktop/test/c.test.ts": FULL.replace("expect(size()).toBe(2);", ""),
    };
    // Only the file that lost an expect is named.
    expect(removalVerdict(input(changes, base, head))).toEqual({
      problems: [
        "apps/desktop/test/c.test.ts: 4 tests, 5 expects at the base; 4 tests, 4 expects at the head",
      ],
      waived: [],
    });
  });

  test("a rename that loses tests is named by its new path and waived by its old one", () => {
    const to = "apps/desktop/test/layout/cabecalho.test.tsx";
    const changes: FileChange[] = [{ status: "R", path: to, from: FILE }];
    const lost = removalVerdict(input(changes, { [FILE]: FULL }, { [to]: CUT }));
    expect(lost.problems).toEqual([
      `${to} (was ${FILE}): 4 tests, 5 expects at the base; 0 tests, 0 expects at the head`,
    ]);
    const waived = removalVerdict(
      input(changes, { [FILE]: FULL }, { [to]: CUT }, [`x\n\nTests-Removed: ${FILE} — cut`]),
    );
    expect(waived.problems).toEqual([]);
  });

  test("a comment or a spaced call is no test; one test reads in the singular", () => {
    const text = "// call it (once), mark it `x`\ntest('a', () => expect(1).toBe(1));";
    expect(countTests(text)).toEqual({ tests: 1, expects: 1 });
    const one = removalVerdict(input([{ status: "D", path: FILE }], { [FILE]: text }, {}));
    expect(one.problems).toEqual([`${FILE}: 1 test, 1 expect at the base; deleted`]);
  });

  test("a test file renamed to a name that does not run, or a text git cannot read, fails", () => {
    const fixture = "apps/desktop/test/visual-direction/cabecalho.fixture.tsx";
    const renamed = removalVerdict(
      input([{ status: "R", path: fixture, from: FILE }], { [FILE]: FULL }, { [fixture]: FULL }),
    );
    expect(renamed.problems).toEqual([
      `${fixture} (was ${FILE}): 4 tests, 5 expects at the base; not a test file at the head`,
    ]);
    const unread = [
      removalVerdict(input([{ status: "M", path: FILE }], { [FILE]: FULL }, {})),
      removalVerdict(input([{ status: "M", path: FILE }], {}, { [FILE]: FULL })),
    ];
    expect(unread.map((verdict) => verdict.problems)).toEqual([
      [`${FILE}: git could not read it at the head`],
      [`${FILE}: git could not read it at the base`],
    ]);
  });

  test("a trailer key in any case, a path in backticks, a dash with no space after or a reason with a dash waives", () => {
    const trailers = [
      `tests-removed: \`${FILE}\` —moved`,
      `Tests-Removed: ${FILE} – moved`,
      `Tests-Removed: ${FILE} - moved - twice`,
      `Tests-Removed: ${FILE} — moved - twice`,
    ];
    const reasons = trailers.map(
      (trailer) =>
        removalVerdict(
          input([{ status: "M", path: FILE }], { [FILE]: FULL }, { [FILE]: CUT }, [
            `x\n\n${trailer}`,
          ]),
        ).waived,
    );
    expect(reasons).toEqual([
      [`${CUT_LINE} (waived: moved)`],
      [`${CUT_LINE} (waived: moved)`],
      [`${CUT_LINE} (waived: moved - twice)`],
      [`${CUT_LINE} (waived: moved - twice)`],
    ]);
  });

  test("a modifier chained before .each counts each table as a test", () => {
    const text = 'test.concurrent.each([1])("a", () => {});\nit.skip.each`x`("b", () => {});';
    expect(countTests(text)).toEqual({ tests: 2, expects: 0 });
  });

  test("the first dash of any style ends the paths; a rename is waived by its new path too", () => {
    const dashed = removalVerdict(
      input([{ status: "M", path: FILE }], { [FILE]: FULL }, { [FILE]: CUT }, [
        `x\n\nTests-Removed: ${FILE} - moved to b — see #12`,
      ]),
    );
    expect(dashed.waived).toEqual([`${CUT_LINE} (waived: moved to b — see #12)`]);
    const to = "apps/desktop/test/layout/cabecalho.test.tsx";
    const renamed = removalVerdict(
      input([{ status: "R", path: to, from: FILE }], { [FILE]: FULL }, { [to]: CUT }, [
        `x\n\nTests-Removed: ${to} — cut`,
      ]),
    );
    expect(renamed.problems).toEqual([]);
  });

  test("over git: a diff git cannot list fails, since nothing was checked", () => {
    const git = (args: string[]) =>
      args[0] === "merge-base" ? "base1\n" : args[0] === "log" ? "" : null;
    expect(runTestsRemoved({ git }).code).toBe(1);
  });

  test("over git: no merge-base with main fails, since nothing was checked", () => {
    expect(runTestsRemoved({ git: () => null }).code).toBe(1);
  });

  test("over git: the net diff from the merge-base, every commit's message, exit 1 on a loss", () => {
    const answers: Record<string, string> = {
      "merge-base HEAD origin/main": "base1\n",
      "log --format=%B%x00 base1..HEAD": "chore(desktop): merge main into mv-shell2\n\x00",
      "diff --name-status -M base1..HEAD": `M\t${FILE}\n`,
      [`show base1:${FILE}`]: FULL,
      [`show HEAD:${FILE}`]: CUT,
    };
    const git = (args: string[]) => answers[args.join(" ")] ?? null;
    const failed = runTestsRemoved({ git });
    expect(failed.code).toBe(1);
    expect(failed.output).toContain(CUT_LINE);
    expect(failed.output).toContain("Tests-Removed:");
    answers["log --format=%B%x00 base1..HEAD"] = `x\n\nTests-Removed: ${FILE} — moved\n\x00`;
    expect(runTestsRemoved({ git })).toEqual({
      code: 0,
      output: `tests-removed: no test file lost tests or expects but the waived ones:\n  - ${CUT_LINE} (waived: moved)`,
    });
    answers["diff --name-status -M base1..HEAD"] = "A\tapps/x.test.ts\n";
    expect(runTestsRemoved({ git })).toEqual({
      code: 0,
      output: "tests-removed: no test file lost tests or expects",
    });
  });
});
