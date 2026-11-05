import { describe, expect, test } from "bun:test";
import {
  type EvalTask,
  grade,
  parseStream,
  type RunFacts,
  scorecard,
} from "../lib/harness-eval.ts";

const TASK: EvalTask = {
  name: "slug-case",
  area: "slug-case",
  testFile: "scripts/test/slug-case.test.ts",
  prompt: "…",
};

const line = (event: object) => JSON.stringify(event);
const bash = (id: string, command: string) =>
  line({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
  });
const result = (id: string, text: string) =>
  line({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }],
    },
  });

const RED =
  "(fail) slug-case > lowercases\nerror: expect(received).toBe(expected)\n 0 pass\n 1 fail";
const STREAM = [
  line({ type: "system", subtype: "init" }),
  line({ type: "assistant", message: { content: [{ type: "text", text: "Starting." }] } }),
  bash("t1", "bun --config=bunfig.area.toml test scripts/test/slug-case.test.ts"),
  result("t1", RED),
  bash("t2", 'git add scripts/test/slug-case.test.ts && git commit -m "test(slug-case): red"'),
  line({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "[x 1a2b] test" }] },
  }),
  line({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: {} }] },
  }),
  line({
    type: "result",
    total_cost_usd: 0.42,
    num_turns: 9,
    is_error: false,
    permission_denials: [{}, {}],
  }),
].join("\n");

const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  ...parseStream(STREAM),
  commits: [
    { subject: "test(slug-case): red", files: ["scripts/test/slug-case.test.ts"] },
    { subject: "feat(slug-case): green", files: ["scripts/lib/slug-case.ts"] },
  ],
  auditCode: 0,
  relatedCode: 0,
  ...over,
});

describe("harness-eval", () => {
  test("the stream gives the Bash steps with their output in order, the cost, the turns and the denials", () => {
    expect(parseStream(STREAM)).toEqual({
      steps: [
        {
          command: "bun --config=bunfig.area.toml test scripts/test/slug-case.test.ts",
          output: RED,
        },
        {
          command: 'git add scripts/test/slug-case.test.ts && git commit -m "test(slug-case): red"',
          output: "[x 1a2b] test",
        },
      ],
      costUsd: 0.42,
      turns: 9,
      denials: 2,
      isError: false,
    });
  });

  test("a line that is not JSON (stderr, a blank line) is skipped, not fatal", () => {
    let parsed: ReturnType<typeof parseStream> | undefined;
    expect(() => {
      parsed = parseStream(`${STREAM}\n\nnot json: a warning on stderr\n`);
    }).not.toThrow();
    expect(parsed).toEqual(parseStream(STREAM));
  });

  test("a run that followed docs/TDD.md passes every grader", () => {
    expect(grade(TASK, facts())).toEqual({
      "test-file": true,
      "test-first": true,
      "red-by-assertion": true,
      audit: true,
      coverage: true,
      "no-error": true,
    });
  });

  test("each grader fails on its own lapse", () => {
    const wrongPlace = facts({
      commits: [
        { subject: "test(slug-case): red", files: ["scripts/lib/slug-case.test.ts"] },
        { subject: "feat(slug-case): green", files: ["scripts/lib/slug-case.ts"] },
      ],
    });
    expect(grade(TASK, wrongPlace)["test-file"]).toBe(false);
    const featFirst = facts({
      commits: [
        { subject: "feat(slug-case): green", files: ["scripts/lib/slug-case.ts"] },
        { subject: "test(slug-case): red", files: ["scripts/test/slug-case.test.ts"] },
      ],
    });
    expect(grade(TASK, featFirst)["test-first"]).toBe(false);
    const redByError = facts({
      steps: [
        {
          command: "bun --config=bunfig.area.toml test scripts/test/slug-case.test.ts",
          output: "error: Cannot find module '../lib/slug-case.ts'\n 0 pass\n 1 fail",
        },
        { command: 'git commit -m "test(slug-case): red"', output: "" },
      ],
    });
    expect(grade(TASK, redByError)["red-by-assertion"]).toBe(false);
    const redAfterCommit = facts({ steps: [...facts().steps].reverse() });
    expect(grade(TASK, redAfterCommit)["red-by-assertion"]).toBe(false);
    expect(grade(TASK, facts({ auditCode: 1 })).audit).toBe(false);
    expect(grade(TASK, facts({ relatedCode: 1 })).coverage).toBe(false);
    expect(grade(TASK, facts({ isError: true }))["no-error"]).toBe(false);
  });

  test("the scorecard counts each grader over the samples and gives the cost and turns", () => {
    const runs = [
      facts(),
      facts({ auditCode: 1, costUsd: 0.9, turns: 15 }),
      facts({ costUsd: 0.3, turns: 6 }),
    ];
    expect(scorecard(TASK, runs)).toBe(
      [
        "slug-case: 3 sample(s)",
        "  test-file         3/3",
        "  test-first        3/3",
        "  red-by-assertion  3/3",
        "  audit             2/3",
        "  coverage          3/3",
        "  no-error          3/3",
        "  cost: $1.62 in all, $0.54 a run (min $0.30, max $0.90)",
        "  turns: 10 a run (min 6, max 15); permission denials: 6",
      ].join("\n"),
    );
  });
});
