import { describe, expect, test } from "bun:test";
import {
  type FileChange,
  runStructureGuard,
  type StructureInput,
  structureVerdict,
} from "../../lib/structure-guard.ts";

const TEST_BEFORE = [
  'import { describe, expect, test } from "bun:test";',
  'import { total } from "../src/board/board.ts";',
  "",
  'test("a total", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
].join("\n");

/** The same test after a move: only its import paths changed, in a multi-line import. */
const TEST_MOVED = [
  'import { describe, expect, test } from "bun:test";',
  "import {",
  "  total,",
  '} from "../src/board/cards.ts";',
  "",
  'test("a total", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
].join("\n");

const EN_BEFORE = 'export const en = {\n  board: { title: "Board", empty: "No cards" },\n};\n';

/** A fixture PR: the files at the base and at the head, and what changed between them. */
function pr(
  commits: string[],
  base: Record<string, string>,
  head: Record<string, string>,
  changes: FileChange[],
  labels: string[] = [],
): StructureInput {
  return {
    commits,
    labels,
    changes,
    before: (path) => base[path] ?? null,
    after: (path) => head[path] ?? null,
  };
}

const MOVE = ["refactor(board): the totals move to cards.ts (#1523)"];
const TEST = "apps/daemon/test/board/board.test.ts";

/** A store test before a slice move (#1732, from #1731). */
const STORE_BEFORE = [
  'test("budgets", async () => {',
  "  await act(() => store.checkClientBudgets());",
  "  store.addCard(card); store.refresh();",
  "  expect(store.clientBudgets.length).toBe(1);",
  "});",
].join("\n");

/** Each slice move as the store test reads it after the move. */
const STORE_SLICED = STORE_BEFORE.replace(
  "store.checkClientBudgets()",
  "store.clientBudgets.check()",
).replace("store.addCard(card); store.refresh()", "store.cards.add(card); store.board.refresh()");

describe("structure-guard: a store member moved under a slice (#1732)", () => {
  const change: FileChange[] = [{ status: "M", path: TEST }];

  test("a test whose lines only move store members under a slice passes", () => {
    const verdict = structureVerdict(
      pr(MOVE, { [TEST]: STORE_BEFORE }, { [TEST]: STORE_SLICED }, change),
    );
    expect(verdict).toEqual({ structural: true, problems: [] });
  });

  test("a slice move next to a changed assertion, or a member that is not the old one, still fails", () => {
    const assertion = STORE_SLICED.replace("toBe(1)", "toBe(2)");
    const otherMember = STORE_BEFORE.replace("store.addCard(card)", "store.cards.remove(card)");
    const verdicts = [assertion, otherMember].map(
      (head) =>
        structureVerdict(pr(MOVE, { [TEST]: STORE_BEFORE }, { [TEST]: head }, change)).problems,
    );
    expect(verdicts).toEqual([
      [`${TEST}: changed beyond its import paths`],
      [`${TEST}: changed beyond its import paths`],
    ]);
  });
});

describe("structure-guard (#1602)", () => {
  test("a move whose tests change only in their import paths passes", () => {
    const verdict = structureVerdict(
      pr(MOVE, { [TEST]: TEST_BEFORE }, { [TEST]: TEST_MOVED }, [{ status: "M", path: TEST }]),
    );
    expect(verdict).toEqual({ structural: true, problems: [] });
  });

  test("a move that changes an assertion names the test as coupled to an implementation detail", () => {
    const changed = TEST_MOVED.replace("toBe(5)", "toBe(6)");
    const verdict = structureVerdict(
      pr(MOVE, { [TEST]: TEST_BEFORE }, { [TEST]: changed }, [{ status: "M", path: TEST }]),
    );
    expect(verdict.structural).toBe(true);
    expect(verdict.problems).toEqual([`${TEST}: changed beyond its import paths`]);
  });

  test("a renamed test passes when only its paths changed, and fails when its body changed", () => {
    const to = "apps/daemon/test/cards.test.ts";
    const renamed = structureVerdict(
      pr(MOVE, { [TEST]: TEST_BEFORE }, { [to]: TEST_MOVED }, [
        { status: "R", path: to, from: TEST },
      ]),
    );
    expect(renamed.problems).toEqual([]);
    const edited = structureVerdict(
      pr(MOVE, { [TEST]: TEST_BEFORE }, { [to]: TEST_MOVED.replace('"a total"', '"the sum"') }, [
        { status: "R", path: to, from: TEST },
      ]),
    );
    expect(edited.problems).toEqual([`${to}: changed beyond its import paths`]);
  });

  test("a move that adds or deletes a test file fails", () => {
    const added = "apps/daemon/test/cards.test.ts";
    const verdict = structureVerdict(
      pr(MOVE, { [TEST]: TEST_BEFORE }, { [added]: TEST_BEFORE }, [
        { status: "A", path: added },
        { status: "D", path: TEST },
      ]),
    );
    expect(verdict.problems).toEqual([`${added}: a test added`, `${TEST}: a test deleted`]);
  });

  test("a dictionary split that keeps every text passes; a changed text fails", () => {
    const en = "apps/desktop/src/i18n/en.ts";
    const board = "apps/desktop/src/i18n/en/board.ts";
    const split = {
      [en]: 'import { board } from "./en/board.ts";\nexport const en = { board };\n',
      [board]: 'export const board = { title: "Board", empty: "No cards" };\n',
    };
    const changes: FileChange[] = [
      { status: "M", path: en },
      { status: "A", path: board },
    ];
    expect(structureVerdict(pr(MOVE, { [en]: EN_BEFORE }, split, changes)).problems).toEqual([]);
    const reworded = { ...split, [board]: split[board].replace("No cards", "Nothing here") };
    expect(structureVerdict(pr(MOVE, { [en]: EN_BEFORE }, reworded, changes)).problems).toEqual([
      "apps/desktop/src/i18n: a dictionary text changed (No cards, Nothing here)",
    ]);
  });

  test("a dictionary key named import is not an import statement: moving a later block keeps every text", () => {
    const en = "apps/desktop/src/i18n/en.ts";
    const vault = "apps/desktop/src/i18n/en/vault.ts";
    const before = [
      "export const en = {",
      "  files: {",
      '    import: "Import selected",',
      '    reveal: "Reveal hidden lines",',
      "  },",
      "  vault: { hint: 'Read from \"the vault\"' },",
      "};",
      "",
    ].join("\n");
    const head = {
      [en]: 'import { vault } from "./en/vault.ts";\nexport const en = {\n  files: {\n    import: "Import selected",\n    reveal: "Reveal hidden lines",\n  },\n  ...vault,\n};\n',
      [vault]: "export const vault = { vault: { hint: 'Read from \"the vault\"' } };\n",
    };
    const changes: FileChange[] = [
      { status: "M", path: en },
      { status: "A", path: vault },
    ];
    expect(structureVerdict(pr(MOVE, { [en]: before }, head, changes)).problems).toEqual([]);
  });

  test("a PR with any commit that is not a refactor is not a move, unless it has the structure label", () => {
    const changed = TEST_MOVED.replace("toBe(5)", "toBe(6)");
    const files = [{ status: "M", path: TEST }] as FileChange[];
    const mixed = [...MOVE, "test(board): the total of no cards (#1523)"];
    expect(
      structureVerdict(pr(mixed, { [TEST]: TEST_BEFORE }, { [TEST]: changed }, files)),
    ).toEqual({ structural: false, problems: [] });
    const labelled = pr(mixed, { [TEST]: TEST_BEFORE }, { [TEST]: changed }, files, ["structure"]);
    expect(structureVerdict(labelled).structural).toBe(true);
    expect(structureVerdict(pr([], {}, {}, [])).structural).toBe(false);
  });

  test("over git: the range from the merge-base, the commits without merges, the renames", () => {
    const answers: Record<string, string> = {
      "merge-base HEAD origin/main": "base1\n",
      "log --no-merges --format=%s base1..HEAD": `${MOVE[0]}\n`,
      "diff --name-status -M base1..HEAD": `R100\t${TEST}\tapps/daemon/test/cards.test.ts\n`,
      [`show base1:${TEST}`]: TEST_BEFORE,
      "show HEAD:apps/daemon/test/cards.test.ts": TEST_MOVED.replace("toBe(5)", "toBe(7)"),
    };
    const result = runStructureGuard({
      git: (args) => answers[args.join(" ")] ?? null,
      labels: [],
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "apps/daemon/test/cards.test.ts: changed beyond its import paths",
    );
    expect(result.output).toContain("#1604");
  });

  test("over git: a PR that is not a move, or a clean move, exits 0 and says which", () => {
    const answers: Record<string, string> = {
      "merge-base HEAD origin/main": "base1\n",
      "log --no-merges --format=%s base1..HEAD": "feat(board): totals (#1)\n",
      "diff --name-status -M base1..HEAD": "",
    };
    const git = (args: string[]) => answers[args.join(" ")] ?? null;
    expect(runStructureGuard({ git, labels: [] })).toEqual({
      code: 0,
      output: "structure-guard: not a structure-only PR (1 commit is not a refactor)",
    });
    answers["log --no-merges --format=%s base1..HEAD"] = `${MOVE[0]}\n`;
    expect(runStructureGuard({ git, labels: [] })).toEqual({
      code: 0,
      output: "structure-guard: a structure-only PR; no test or dictionary text changed",
    });
  });
});
