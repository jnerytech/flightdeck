import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkIssue, type IssueDeps, runIssue } from "../../lib/issue-spec.ts";

/**
 * Issue #1918: the issue body is the spec. Every `gh` here is a fake that records what was asked;
 * nothing reaches GitHub.
 */

const HEAD = (kind: string) => `Kind: ${kind} · Parent: none · Budget: 30 min`;
const DONE = "## Done when\n- `bun run typecheck` green.\n";
const REFACTOR = `${HEAD("refactor")}\n\n## Why\nx\n\n## Scope\n- a.ts\n\n## Out of scope\n- b\n\n## Tasks\n- [ ] one PR\n\n${DONE}`;
const FEATURE = `${HEAD("feature")}\n\n## Why\nx\n\n## Scope\n- a\n\n## Out of scope\n- b\n\n## Scenarios\n- GIVEN a WHEN b THEN c\n\n## Tasks\n- [ ] one PR\n\n${DONE}`;

function fakes(
  files: Record<string, string> = {},
  answer: { code?: number; stdout?: string; stderr?: string } = {},
  /** Answers one call by its arguments, over `answer`. */
  per: (args: string[]) => { code: number; stderr?: string } | null = () => null,
) {
  const asked: string[][] = [];
  const out: string[] = [];
  const deps: IssueDeps = {
    gh: async (args) => {
      asked.push(args);
      const own = per(args);
      return {
        code: own?.code ?? answer.code ?? 0,
        stdout: answer.stdout ?? "42\n",
        stderr: own?.stderr ?? answer.stderr ?? "",
      };
    },
    readFile: (path) => files[path] ?? null,
    log: (line) => out.push(line),
  };
  return { asked, out, deps };
}

describe("issue-spec: what check enforces", () => {
  test("a feature body with no Scenarios section is refused, naming the section and the kind", () => {
    const body = FEATURE.replace(/## Scenarios\n- GIVEN a WHEN b THEN c\n\n/, "");
    expect(checkIssue(body)).toEqual(["Scenarios: required for feature"]);
  });

  test("a Done when with no backticked command is refused", () => {
    const body = REFACTOR.replace("- `bun run typecheck` green.", "- it works.");
    expect(checkIssue(body)).toEqual(["Done when: name a command that proves it"]);
  });

  test("a refactor body with Why, Scope, Out of scope, Tasks and Done when is valid", () => {
    expect(checkIssue(REFACTOR)).toEqual([]);
    expect(checkIssue(FEATURE)).toEqual([]);
  });

  test("an unknown or missing Kind line names the allowed kinds", () => {
    const allowed = "Kind: use one of feature, bug, refactor, task";
    expect(checkIssue(REFACTOR.replace("Kind: refactor", "Kind: epic"))).toEqual([allowed]);
    expect(checkIssue(REFACTOR.replace(/^Kind:.*\n\n/, ""))).toEqual([allowed]);
    expect(checkIssue("")).toEqual([allowed]);
  });

  test("the header's Parent and Budget are checked", () => {
    const bad = REFACTOR.replace("Parent: none · Budget: 30 min", "Parent: 12 · Budget: soon");
    expect(checkIssue(bad)).toEqual(["Parent: write #N or none", "Budget: write <N> min"]);
    expect(checkIssue(REFACTOR.replace("Parent: none", "Parent: #12"))).toEqual([]);
  });

  test("a scenario that is not GIVEN WHEN THEN does not count, and the list items count", () => {
    const weak = FEATURE.replace("GIVEN a WHEN b THEN c", "it should work");
    expect(checkIssue(weak)).toEqual([
      'Scenarios: write at least one "GIVEN … WHEN … THEN …" item',
    ]);
  });

  test("Tasks needs a checkbox item for a feature and a refactor, and Out of scope is required for both", () => {
    const noTask = FEATURE.replace("- [ ] one PR", "one PR");
    expect(checkIssue(noTask)).toEqual(['Tasks: write at least one "- [ ]" item']);
    expect(checkIssue(REFACTOR.replace(/## Out of scope\n- b\n\n/, ""))).toEqual([
      "Out of scope: required for refactor",
    ]);
  });

  test("a bug needs Why, What happens, Expected, Repro, a scenario and Done when; Scope is not asked", () => {
    const bug = `${HEAD("bug")}\n\n## Why\nx\n\n## What happens\na\n\n## Expected\nb\n\n## Repro\n1. c\n\n## Scenarios\n- GIVEN a WHEN b THEN c\n\n${DONE}`;
    expect(checkIssue(bug)).toEqual([]);
    expect(checkIssue(bug.replace(/## Repro\n1. c\n\n/, ""))).toEqual(["Repro: required for bug"]);
  });

  test("a task needs only Why, Scope and Done when", () => {
    const task = `${HEAD("task")}\n\n## Why\nx\n\n## Scope\n- a\n\n${DONE}`;
    expect(checkIssue(task)).toEqual([]);
    expect(checkIssue(task.replace(/## Scope\n- a\n\n/, ""))).toEqual(["Scope: required for task"]);
  });

  test("a body with Windows line endings is read like one with Unix endings", () => {
    expect(checkIssue(FEATURE.replaceAll("\n", "\r\n"))).toEqual([]);
    expect(checkIssue(REFACTOR.replaceAll("\n", "\r\n"))).toEqual([]);
  });

  test("a Done when line that is plain text with a backticked command counts", () => {
    expect(
      checkIssue(REFACTOR.replace("- `bun run typecheck` green.", "Run `bun run typecheck`.")),
    ).toEqual([]);
  });

  test("a kind that only starts like an allowed one is refused", () => {
    expect(checkIssue(REFACTOR.replace("Kind: refactor", "Kind: refactor-x"))).toEqual([
      "Kind: use one of feature, bug, refactor, task",
    ]);
  });

  test("a heading inside a code fence is no section", () => {
    const body = REFACTOR.replace("## Why\nx", "## Why\n```\n## Scenarios\n```");
    expect(checkIssue(body)).toEqual([]);
  });
});

describe("issue-spec: the doc's examples", () => {
  test("every example in docs/issue-format.md is a valid body, one per kind", () => {
    const file = join(import.meta.dir, "..", "..", "..", "docs", "issue-format.md");
    const doc = existsSync(file) ? readFileSync(file, "utf8") : "";
    const examples = [...doc.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1] as string);
    expect(examples.map((e) => /^Kind: (\w+)/.exec(e)?.[1])).toEqual([
      "feature",
      "bug",
      "refactor",
      "task",
    ]);
    expect(examples.flatMap((e) => checkIssue(e))).toEqual([]);
  });
});

describe("issue-spec: the commands", () => {
  test("check on an invalid body prints each problem and exits 1; a valid one prints nothing and exits 0", async () => {
    const bad = fakes({
      "bad.md": FEATURE.replace(/## Scenarios\n- GIVEN a WHEN b THEN c\n\n/, ""),
    });
    expect([await runIssue(["check", "--body-file", "bad.md"], bad.deps), bad.out]).toEqual([
      1,
      ["Scenarios: required for feature"],
    ]);
    const good = fakes({ "good.md": REFACTOR });
    expect([await runIssue(["check", "--body-file", "good.md"], good.deps), good.out]).toEqual([
      0,
      [],
    ]);
  });

  test("check <n> reads the issue's body with gh api", async () => {
    const f = fakes({}, { stdout: REFACTOR });
    expect(await runIssue(["check", "7"], f.deps)).toBe(0);
    expect(f.asked).toEqual([["api", "repos/jnerytech/flightdeck/issues/7", "--jq", ".body"]]);
  });

  test("new with an invalid body makes no gh call and exits 1", async () => {
    const f = fakes({ "bad.md": "just text" });
    expect(await runIssue(["new", "--title", "T", "--body-file", "bad.md"], f.deps)).toBe(1);
    expect(f.asked).toEqual([]);
  });

  test("new with a valid body posts the title, the body, the assignee and the mini-spec label, and prints the number", async () => {
    const f = fakes({ "good.md": REFACTOR }, { stdout: "1919\n" });
    expect(await runIssue(["new", "--title", "A title", "--body-file", "good.md"], f.deps)).toBe(0);
    expect(f.asked).toEqual([
      [
        "api",
        "-X",
        "POST",
        "repos/jnerytech/flightdeck/issues",
        "-f",
        "title=A title",
        "-f",
        `body=${REFACTOR}`,
        "-f",
        "assignees[]=jnerytech",
        "-f",
        "labels[]=mini-spec",
        "--jq",
        ".number",
      ],
    ]);
    expect(f.out).toEqual(["1919"]);
  });

  test("edit checks the body, then patches it", async () => {
    const f = fakes({ "good.md": REFACTOR, "bad.md": "x" });
    expect(await runIssue(["edit", "7", "--body-file", "bad.md"], f.deps)).toBe(1);
    expect(f.asked).toEqual([]);
    expect(await runIssue(["edit", "7", "--body-file", "good.md"], f.deps)).toBe(0);
    // The body is patched with no labels argument (a PATCH would replace the issue's labels), then
    // the label is added alone through the labels endpoint.
    expect(f.asked).toEqual([
      ["api", "-X", "PATCH", "repos/jnerytech/flightdeck/issues/7", "-f", `body=${REFACTOR}`],
      [
        "api",
        "-X",
        "POST",
        "repos/jnerytech/flightdeck/issues/7/labels",
        "-f",
        "labels[]=mini-spec",
      ],
    ]);
  });

  test("edit whose label call fails after the body was saved exits 1 and says so", async () => {
    const f = fakes({ "good.md": REFACTOR }, {}, (args) =>
      args.includes("labels[]=mini-spec") ? { code: 1, stderr: "label API down\nmore" } : null,
    );
    expect(await runIssue(["edit", "7", "--body-file", "good.md"], f.deps)).toBe(1);
    expect(f.out.join("\n")).toContain("label API down");
    expect(f.out.join("\n")).toContain("the body is saved");
    expect(f.out.join("\n")).toContain("the label is not");
    expect(f.asked).toHaveLength(2);
  });

  test("edit whose body call fails makes no label call", async () => {
    const f = fakes({ "good.md": REFACTOR }, { code: 1 });
    expect(await runIssue(["edit", "7", "--body-file", "good.md"], f.deps)).toBe(1);
    expect(f.asked).toHaveLength(1);
  });

  test("check makes no write: only a read of the issue", async () => {
    const f = fakes({}, { stdout: REFACTOR });
    await runIssue(["check", "7"], f.deps);
    expect(f.asked.every((args) => !args.includes("POST") && !args.includes("PATCH"))).toBe(true);
  });

  test("a gh failure, a missing file, a bad number and a missing title are refused with a message", async () => {
    const down = fakes({ "good.md": REFACTOR }, { code: 1, stdout: "" });
    expect(await runIssue(["new", "--title", "T", "--body-file", "good.md"], down.deps)).toBe(1);
    const f = fakes();
    expect(await runIssue(["check", "--body-file", "nope.md"], f.deps)).toBe(2);
    expect(await runIssue(["edit", "x7", "--body-file", "nope.md"], f.deps)).toBe(2);
    expect(await runIssue(["new", "--body-file", "nope.md"], f.deps)).toBe(2);
    expect(await runIssue([], f.deps)).toBe(2);
    expect(f.asked).toEqual([]);
    expect(f.out.length).toBeGreaterThan(0);
  });
});
