import { describe, expect, test } from "bun:test";
import {
  childEnv,
  type EvalRunner,
  type EvalTask,
  evalOptions,
  grade,
  parseStream,
  prepareClone,
  type RunFacts,
  savedFacts,
  scorecard,
  sessionArgs,
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

describe("harness-eval: the CLI's options", () => {
  test("defaults to 3 samples, a $1 budget, sonnet, and no --keep", () => {
    expect(evalOptions([])).toEqual({ samples: 3, budget: "1", model: "sonnet", keep: false });
    expect(evalOptions(["--samples", "2", "--budget", "0.5", "--model", "opus", "--keep"])).toEqual(
      {
        samples: 2,
        budget: "0.5",
        model: "opus",
        keep: true,
      },
    );
  });

  test("refuses samples that are not a whole number of at least 1, and a budget that is not positive", () => {
    for (const argv of [
      ["--samples", "0"],
      ["--samples", "x"],
      ["--samples", "1.5"],
    ]) {
      expect(String(evalOptions(argv))).toContain("--samples");
    }
    for (const argv of [
      ["--budget", "0"],
      ["--budget", "-1"],
      ["--budget", "abc"],
    ]) {
      expect(String(evalOptions(argv))).toContain("--budget");
    }
  });
});

describe("harness-eval: what the session may touch", () => {
  const options = { model: "sonnet", budget: "1" };
  const split = (args: string[]) => {
    const allowed = args.indexOf("--allowedTools");
    const denied = args.indexOf("--disallowedTools");
    return { allowed: args.slice(allowed + 1, denied), denied: args.slice(denied + 1) };
  };

  test("Read, Edit and Write reach the clone only, and git can neither push, change a remote nor write a file", () => {
    const args = sessionArgs("task", options, { dir: "/tmp/fd-eval-x", home: "/home/me" });
    const { allowed, denied } = split(args);
    expect(args.slice(0, 2)).toEqual(["-p", "task"]);
    expect(allowed).toContain("Read(./**)");
    expect(allowed).toContain("Edit(./**)");
    expect(allowed).toContain("Write(./**)");
    expect(allowed.filter((tool) => /^(Read|Edit|Write)$/.test(tool))).toEqual([]);
    expect(allowed.filter((tool) => /^Bash\(git (diff|log)\*\)$/.test(tool))).toEqual([]);
    for (const tool of ["Bash(git push *)", "Bash(git remote *)", "Bash(git * --output*)"]) {
      expect(denied).toContain(tool);
    }
    for (const tool of ["Read(~/**)", "Edit(~/**)", "Write(~/**)"]) expect(denied).toContain(tool);
    // #986 security review: `git diff <path> <path>` with a path outside the clone compares files
    // (an implied --no-index), so it reads what Read(~/**) denies.
    for (const tool of [
      "Bash(git * --no-index*)",
      "Bash(git diff /*)",
      "Bash(git diff * /*)",
      "Bash(git diff ~*)",
      "Bash(git diff * ~*)",
      "Bash(git diff ../*)",
      "Bash(git diff *../*)",
      // A variable or a drive letter names a path outside the clone too (re-review of #986).
      "Bash(git diff $*)",
      "Bash(git diff *$*)",
      "Bash(git diff *:*)",
    ]) {
      expect(denied).toContain(tool);
    }
  });

  test("a clone inside the home folder does not deny the home folder, which would deny the clone", () => {
    const { denied } = split(
      sessionArgs("task", options, { dir: "/home/me/tmp/x", home: "/home/me" }),
    );
    expect(denied.filter((tool) => tool.includes("~/"))).toEqual([]);
    expect(denied).toContain("Bash(git push *)");
  });

  test("the sample's processes keep the PATH, the home and the locale, and no token or key", () => {
    const env = childEnv({
      PATH: "/bin",
      HOME: "/home/me",
      LANG: "C.UTF-8",
      GH_TOKEN: "t",
      ANTHROPIC_API_KEY: "k",
      SONAR_TOKEN: "s",
      AWS_SECRET_ACCESS_KEY: "a",
      TMPDIR: undefined,
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/home/me", LANG: "C.UTF-8" });
  });
});

describe("harness-eval: preparing a clone", () => {
  const places = { root: "/repo", head: "abc", dir: "/tmp/x", bun: "/bin/bun" };
  const runner = (fail: string, remotes = "") => {
    const calls: string[] = [];
    const run: EvalRunner = (command) => {
      const line = command.join(" ");
      calls.push(line);
      if (line === "git remote") return { code: 0, out: remotes };
      return { code: line.includes(fail) ? 1 : 0, out: "" };
    };
    return { run, calls };
  };

  test("clones, checks out the head, removes origin, checks no remote is left and installs, in that order", () => {
    const { run, calls } = runner("none");
    expect(prepareClone(run, places)).toBeNull();
    expect(calls).toEqual([
      "git clone --quiet /repo /tmp/x",
      "git checkout --quiet abc",
      "git remote remove origin",
      "git remote",
      "/bin/bun install --frozen-lockfile",
    ]);
  });

  test("stops at the first step that fails, and names it", () => {
    for (const step of ["clone", "checkout", "remove origin", "install"]) {
      const { run, calls } = runner(step);
      expect(String(prepareClone(run, places))).toContain(step);
      expect(calls.at(-1)).toContain(step);
    }
  });

  test("refuses a clone that still has a remote, before the install", () => {
    const { run, calls } = runner("none", "origin\n");
    expect(String(prepareClone(run, places))).toContain("remote");
    expect(calls.at(-1)).toBe("git remote");
  });
});

describe("harness-eval: the saved report", () => {
  test("keeps each step's command and drops its output, which may hold a file or an env value", () => {
    const run = facts({ steps: [{ command: "env", output: "GH_TOKEN=t" }] });
    expect(savedFacts(run)).toEqual({ ...run, steps: [{ command: "env", output: "" }] });
  });
});
