/**
 * The eval of the `test-quality-reviewer` agent (issue #1604): `scripts/test-review-eval.ts`
 * plants one test/feat pair per case in a throwaway clone, runs the agent headless on it, and
 * these deterministic checks read its report. The cases plant the Khorikov criteria of
 * `docs/TDD.md` ("What a test checks"). No model grades a model here.
 */
import { DENIED_TOOLS, type EvalOptions, homeDenials } from "./harness-eval.ts";

/** One planted commit: its message and the files it adds. */
export interface PlantedCommit {
  subject: string;
  body: string;
  files: { path: string; content: string }[];
}

/** What the report must say for a bad case: a row naming the file, one of the words, and `high` when set. */
export interface TestReviewExpect {
  file: string;
  words: string[];
  high?: boolean;
}

export interface TestReviewCase {
  name: string;
  /** The test commit, then the feat commit. */
  commits: PlantedCommit[];
  /** null: a clean pair, no high finding. */
  expect: TestReviewExpect | null;
}

const lines = (...text: string[]): string => `${text.join("\n")}\n`;

/** A test commit with its red evidence, and the feat commit that makes it green. */
function pair(
  area: string,
  behavior: string,
  red: string,
  test: string,
  sources: { path: string; content: string }[],
): PlantedCommit[] {
  return [
    {
      subject: `test(${area}): ${behavior}`,
      body: `Red by assertion: ${red}`,
      files: [{ path: `scripts/test/${area}.test.ts`, content: test }],
    },
    { subject: `feat(${area}): ${behavior} (#1604)`, body: "", files: sources },
  ];
}

const CART_TEST = lines(
  'import { expect, test } from "bun:test";',
  'import { calls, subtotalCents, total } from "../lib/tq-cart.ts";',
  "",
  'test("total works out the subtotal first, then the tax", () => {',
  "  calls.length = 0;",
  "  total([{ price: 2.5, qty: 2 }], 0.1);",
  '  expect(calls).toEqual(["subtotal", "tax"]);',
  "  expect(subtotalCents([{ price: 2.5, qty: 2 }])).toBe(500);",
  "});",
);

const CART = lines(
  "export interface Line {",
  "  price: number;",
  "  qty: number;",
  "}",
  "",
  "/** Exported for its test. */",
  "export const calls: string[] = [];",
  "",
  "/** Exported for its test. */",
  "export function subtotalCents(items: Line[]): number {",
  "  return items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.qty, 0);",
  "}",
  "",
  "/** The total of a cart with its tax, in currency units. */",
  "export function total(items: Line[], taxRate: number): number {",
  '  calls.push("subtotal");',
  "  const subtotal = subtotalCents(items);",
  '  calls.push("tax");',
  "  return Math.round(subtotal * (1 + taxRate)) / 100;",
  "}",
);

const NOTES_TEST = lines(
  'import { afterAll, expect, mock, test } from "bun:test";',
  'import * as real from "../lib/tq-notes-store.ts";',
  "",
  "const saved: string[][] = [];",
  'mock.module("../lib/tq-notes-store.ts", () => ({',
  "  readNotes: () => [],",
  "  writeNotes: (_dir: string, notes: string[]) => saved.push(notes),",
  "}));",
  "afterAll(() => {",
  '  mock.module("../lib/tq-notes-store.ts", () => real);',
  "});",
  "",
  'test("a note is added to the stored ones", async () => {',
  '  const { addNote } = await import("../lib/tq-notes.ts");',
  '  addNote("notes", "buy milk");',
  '  expect(saved).toEqual([["buy milk"]]);',
  "});",
);

const NOTES_STORE = lines(
  'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  "",
  "/** The notes kept in `dir`, oldest first; none when the file is missing. */",
  "export function readNotes(dir: string): string[] {",
  "  try {",
  '    return JSON.parse(readFileSync(join(dir, "notes.json"), "utf8")) as string[];',
  "  } catch {",
  "    return [];",
  "  }",
  "}",
  "",
  "export function writeNotes(dir: string, notes: string[]): void {",
  "  mkdirSync(dir, { recursive: true });",
  '  writeFileSync(join(dir, "notes.json"), JSON.stringify(notes));',
  "}",
);

const NOTES = lines(
  'import { readNotes, writeNotes } from "./tq-notes-store.ts";',
  "",
  "/** Adds a note after the ones kept in `dir`. */",
  "export function addNote(dir: string, text: string): void {",
  "  writeNotes(dir, [...readNotes(dir), text.trim()]);",
  "}",
);

const DISCOUNT_TEST = lines(
  'import { expect, test } from "bun:test";',
  'import { discounted } from "../lib/tq-discount.ts";',
  "",
  'test("a discount takes its percent off the price, to the cent", () => {',
  "  for (const [price, percent] of [[100, 10], [19.99, 25]] as const) {",
  "    expect(discounted(price, percent)).toBe(Math.round(price * (100 - percent)) / 100);",
  "  }",
  "});",
);

const DISCOUNT = lines(
  "/** The price with `percent` off, rounded to the cent. */",
  "export function discounted(price: number, percent: number): number {",
  "  return Math.round(price * (100 - percent)) / 100;",
  "}",
);

const SLUG_TEST = lines(
  'import { expect, test } from "bun:test";',
  'import { slug } from "../lib/tq-slug.ts";',
  "",
  'test("a title becomes lower-case words joined by dashes", () => {',
  '  expect(slug("Hello World")).toBe("hello-world");',
  '  expect(slug("  Déjà vu, again!  ")).toBe("deja-vu-again");',
  '  expect(slug("")).toBe("");',
  "});",
);

const SLUG = lines(
  "/** Lower-case ASCII words of `title`, joined by dashes. */",
  "export function slug(title: string): string {",
  "  return title",
  '    .normalize("NFD")',
  String.raw`    .replace(/[\u0300-\u036f]/g, "")`,
  "    .toLowerCase()",
  '    .replace(/[^a-z0-9]+/g, "-")',
  '    .replace(/^-+|-+$/g, "");',
  "}",
);

export const TEST_REVIEW_CASES: TestReviewCase[] = [
  {
    name: "implementation-detail",
    commits: pair(
      "tq-cart",
      "a cart's total with its tax",
      'expect(received).toEqual(expected): expected ["subtotal", "tax"], received []',
      CART_TEST,
      [{ path: "scripts/lib/tq-cart.ts", content: CART }],
    ),
    expect: {
      file: "tq-cart.test.ts",
      words: ["implementation", "internal", "call order", "private", "exported for"],
    },
  },
  {
    name: "managed-mock",
    commits: pair(
      "tq-notes",
      "notes added to the stored ones",
      'expect(received).toEqual(expected): expected [["buy milk"]], received []',
      NOTES_TEST,
      [
        { path: "scripts/lib/tq-notes-store.ts", content: NOTES_STORE },
        { path: "scripts/lib/tq-notes.ts", content: NOTES },
      ],
    ),
    expect: { file: "tq-notes.test.ts", words: ["managed", "mock.module", "own module"] },
  },
  {
    name: "leaked-knowledge",
    commits: pair(
      "tq-discount",
      "a discount to the cent",
      "expect(received).toBe(expected): expected 90, received 0",
      DISCOUNT_TEST,
      [{ path: "scripts/lib/tq-discount.ts", content: DISCOUNT }],
    ),
    expect: {
      file: "tq-discount.test.ts",
      words: ["leak", "domain knowledge", "same formula", "same logic", "implement", "recomput"],
      high: true,
    },
  },
  {
    name: "clean",
    commits: pair(
      "tq-slug",
      "a title as a slug",
      'expect(received).toBe(expected): expected "hello-world", received ""',
      SLUG_TEST,
      [{ path: "scripts/lib/tq-slug.ts", content: SLUG }],
    ),
    expect: null,
  },
];

/** A table row of the report that marks a high finding. */
const HIGH_ROW = /\|\s*[*`_]*high\b[^|]*\|/i;

/** What every review has, and an error, a quota message or a refusal does not. */
const REVIEW_SHAPE = /\baccept\b|\|\s*Pair\s*\|/i;

/**
 * Whether the report judged the case right: a clean pair has a review and no high row; a bad one
 * has a line that names the test file and one of the words (and is a high row when asked).
 */
export function gradeTestReview(expect: TestReviewExpect | null, report: string): boolean {
  const rows = report.split("\n");
  if (expect === null) return REVIEW_SHAPE.test(report) && !rows.some((row) => HIGH_ROW.test(row));
  const base = expect.file.slice(expect.file.lastIndexOf("/") + 1);
  return rows.some((row) => {
    const lower = row.toLowerCase();
    return (
      row.includes(base) &&
      expect.words.some((word) => lower.includes(word.toLowerCase())) &&
      (expect.high !== true || HIGH_ROW.test(row))
    );
  });
}

/** The prompt of one review: the commits are shown in it, so the review needs no git. */
export function testReviewPrompt(base: string, shown: string): string {
  return [
    `Review the tests of this worktree against the base ${base}. Its commits, oldest first, are`,
    "below as `git show` prints them: do not run git. Report as your Output section says.",
    "",
    "```",
    shown.trimEnd(),
    "```",
  ].join("\n");
}

/**
 * The `claude -p` arguments of one review: the session is the `test-quality-reviewer` agent, may
 * read the clone and run the case's test file, and has no Edit, Write or git; the home folder is
 * denied when the clone is outside it.
 */
export function testReviewArgs(
  prompt: string,
  options: Pick<EvalOptions, "model" | "budget">,
  places: { dir: string; home: string },
  testFile: string,
): string[] {
  const run = `bun --config=bunfig.area.toml test ${testFile}`;
  return [
    "-p",
    prompt,
    "--agent",
    "test-quality-reviewer",
    "--model",
    options.model,
    "--max-budget-usd",
    options.budget,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--allowedTools",
    "Read(./**)",
    `Bash(${run})`,
    `Bash(env -u CLAUDECODE ${run})`,
    "--disallowedTools",
    "Edit",
    "Write",
    "NotebookEdit",
    // No git at all: `git diff <path> <path>` reads any file, and `--output` writes one (#986).
    "Bash(git *)",
    ...DENIED_TOOLS,
    ...homeDenials(places),
  ];
}
