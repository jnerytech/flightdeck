import { describe, expect, test } from "bun:test";
import {
  applyCase,
  gradeReport,
  reportOf,
  reviewArgs,
  reviewPrompt,
  UX_CASES,
  type UxCase,
  uxScorecard,
} from "../lib/ux-review-eval.ts";

// A missing case is an empty one, so its tests fail by assertion, not by a throw.
const byName = (name: string): UxCase =>
  UX_CASES.find((c) => c.name === name) ?? { name, subject: "", files: [], expect: null };

const EN = [
  'import type { Dictionary } from "./index.ts";',
  "",
  "export const en: Dictionary = {",
  '  nav: { back: "Back" },',
  "};",
].join("\n");
const PT = ["export const ptBR = {", '  nav: { back: "Voltar" },', "};"].join("\n");
const dictionaries = (path: string) =>
  path.endsWith("en.ts") ? EN : path.endsWith("pt-BR.ts") ? PT : null;

/** The text of the line `line` (1-based) of the case's first written file. */
function lineOf(name: string, line: number): string {
  const applied = applyCase(byName(name), dictionaries);
  return typeof applied === "string"
    ? applied
    : (applied.writes[0]?.text.split("\n")[line - 1] ?? "");
}

describe("ux-review-eval (#983)", () => {
  test("the cases are a literal, a key missing from pt-BR, an element with no focus style, and a clean change", () => {
    expect(UX_CASES.map((c) => c.name)).toEqual(["literal", "missing-pt-br", "no-focus", "clean"]);
    expect(UX_CASES.map((c) => c.expect === null)).toEqual([false, false, false, true]);
  });

  test("each bad case's expected line holds the defect it plants", () => {
    expect(lineOf("literal", byName("literal").expect?.line ?? 0)).toContain(
      "Your draft is not saved yet.",
    );
    const chip = lineOf("no-focus", byName("no-focus").expect?.line ?? 0);
    expect(chip.includes("<button") && chip.includes("outline-none")).toBe(true);
    expect(chip.includes("focus")).toBe(false);
  });

  test("a new file is written as it is; an inserted line goes right after its anchor", () => {
    const literal = applyCase(byName("literal"), () => null);
    expect(typeof literal === "string" ? literal : literal.writes.map((w) => w.path)).toEqual([
      "apps/desktop/src/ui/DraftBanner.tsx",
    ]);
    const missing = applyCase(byName("missing-pt-br"), dictionaries);
    expect(typeof missing === "string" ? missing : missing.writes).toEqual([
      {
        path: "apps/desktop/src/i18n/en.ts",
        text: EN.replace(
          "export const en: Dictionary = {\n",
          'export const en: Dictionary = {\n  evalDraft: { save: "Save draft" },\n',
        ),
      },
    ]);
    const clean = applyCase(byName("clean"), dictionaries);
    expect(typeof clean === "string" ? clean : clean.writes.map((w) => w.path)).toEqual([
      "apps/desktop/src/i18n/pt-BR.ts",
      "apps/desktop/src/i18n/en.ts",
    ]);
  });

  test("a case whose anchor line is gone is refused, naming the file", () => {
    expect(applyCase(byName("clean"), () => "export const other = {};")).toBe(
      'ux-review-eval: apps/desktop/src/i18n/pt-BR.ts has no line "export const ptBR = {"',
    );
  });

  test("a bad case passes when one report line names the file near the line, with a word of the defect", () => {
    const literal = byName("literal").expect;
    const row = (cell: string) => `| ${cell} | text a person sees is a literal | high | x |`;
    expect(gradeReport(literal, row("apps/desktop/src/ui/DraftBanner.tsx:8"))).toBe(true);
    expect(gradeReport(literal, row("`DraftBanner.tsx:5`"))).toBe(true);
    // Too far from the planted line, no line at all, or the wrong defect.
    expect(gradeReport(literal, row("DraftBanner.tsx:12"))).toBe(false);
    expect(gradeReport(literal, row("DraftBanner.tsx"))).toBe(false);
    expect(gradeReport(literal, "| DraftBanner.tsx:7 | the gap is too wide | low | x |")).toBe(
      false,
    );
    // The file and the word must be on the same line.
    expect(gradeReport(literal, "DraftBanner.tsx:7 is fine\nliteral strings elsewhere")).toBe(
      false,
    );
    const missing = byName("missing-pt-br").expect;
    expect(
      gradeReport(missing, "| pt-BR.ts | `evalDraft.save` is missing | high | en.ts:5 |"),
    ).toBe(true);
    expect(gradeReport(missing, "| en.ts:5 | `evalDraft.save` reads well | low | - |")).toBe(false);
    // #986 review: naming the key and pt-BR is not enough; the line says the key is missing.
    expect(
      gradeReport(missing, "| en.ts:5 | `evalDraft.save` reads well in pt-BR | low | - |"),
    ).toBe(false);
    expect(gradeReport(missing, "- `evalDraft.save` is in en.ts but not in pt-BR.ts (high)")).toBe(
      true,
    );
    const focus = byName("no-focus").expect;
    expect(gradeReport(focus, "- FilterChip.tsx:13: outline-none with no Focus-visible ring")).toBe(
      true,
    );
  });

  test("a clean change passes with no high finding, and fails on a high one or an empty report", () => {
    expect(gradeReport(null, "| en.ts:3 | key order | low | x |\n**accept**")).toBe(true);
    expect(gradeReport(null, "| en.ts:3 | a literal | **High** | x |")).toBe(false);
    expect(gradeReport(null, "  ")).toBe(false);
    // #986 review: a high in backticks or with words after it is still a high.
    expect(gradeReport(null, "| File:line |\n| en.ts:3 | a literal | `high` | x |")).toBe(false);
    expect(gradeReport(null, "| File:line |\n| en.ts:3 | a literal | High (blocks) | x |")).toBe(
      false,
    );
    // An error, a quota message or a refusal is no review: it has no verdict and no table.
    expect(gradeReport(null, "Credit balance is too low")).toBe(false);
    expect(
      gradeReport(null, "| File:line | Finding | Severity | Evidence |\n|---|---|---|---|"),
    ).toBe(true);
  });

  test("the report is the result event's text of the stream", () => {
    const stream = [
      JSON.stringify({ type: "system", subtype: "init" }),
      "",
      "not json",
      JSON.stringify({ type: "result", result: "| a | b |\n**accept**" }),
    ].join("\n");
    expect(reportOf(stream)).toBe("| a | b |\n**accept**");
    expect(reportOf(JSON.stringify({ type: "result", result: 3 }))).toBe("");
  });

  test("a review runs as the ux-reviewer agent with the diff in its prompt, no git, no Edit or Write, and only the four checks", () => {
    const options = { model: "sonnet", budget: "0.5" };
    const prompt = reviewPrompt("abc123", "+  <span>Hi</span>");
    expect(prompt).toBe(
      [
        "Review the UI change of this worktree against the base abc123. Its diff is below: do not run git.",
        "Report as your Output section says.",
        "",
        "```diff",
        "+  <span>Hi</span>",
        "```",
      ].join("\n"),
    );
    const args = reviewArgs(prompt, options, { dir: "/tmp/x", home: "/home/u" });
    expect(args.slice(0, 4)).toEqual(["-p", prompt, "--agent", "ux-reviewer"]);
    const allowed = args.slice(
      args.indexOf("--allowedTools") + 1,
      args.indexOf("--disallowedTools"),
    );
    // #986 security review: a test run takes no flag of its own (no outfile, no other folder).
    expect(allowed).toEqual([
      "Read(./**)",
      "Bash(bun --config=bunfig.area.toml test apps/desktop/test/textos.test.tsx)",
      "Bash(bun --config=bunfig.area.toml test apps/desktop/test/i18n-missing.test.ts)",
      "Bash(bun --config=bunfig.area.toml test apps/desktop/test/layout-ratchet.test.ts)",
      "Bash(bun --config=bunfig.area.toml test apps/desktop/test/state-selectors-ratchet.test.ts)",
    ]);
    const denied = args.slice(args.indexOf("--disallowedTools") + 1);
    // No git at all: `git diff <path> <path>` reads any file, and `--output` writes one.
    for (const tool of ["Edit", "Write", "NotebookEdit", "Bash(git *)", "Bash(git * --output*)"]) {
      expect(denied).toContain(tool);
    }
    expect(denied.slice(-3)).toEqual(["Read(~/**)", "Edit(~/**)", "Write(~/**)"]);
    const inside = reviewArgs("p", options, { dir: "/home/u/tmp/x", home: "/home/u/" });
    expect(inside.includes("Read(~/**)")).toBe(false);
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("0.5");
  });

  test("the scorecard says how many samples judged each case right and marks a miss", () => {
    expect(
      uxScorecard([
        { name: "literal", passed: [true, true] },
        { name: "no-focus", passed: [true, false] },
      ]),
    ).toBe(["literal        2/2", "no-focus       1/2  FAIL"].join("\n"));
  });
});
