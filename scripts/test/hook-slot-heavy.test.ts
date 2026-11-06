import { describe, expect, test } from "bun:test";
import { guardAllowLogs, heavyRunViolation, heavyRunWaived } from "../lib/claude-hooks.ts";

const worker = (command: string) => heavyRunViolation(command, {});
const tests = (n: number) =>
  Array.from({ length: n }, (_, i) => `apps/desktop/test/t${i}.test.ts`).join(" ");

describe("guard: a worker session's full coverage run holds the slot for what CI does anyway (#674)", () => {
  test("a plain, --base or --pr test:related is refused, through the slot or not", () => {
    for (const command of [
      "bun run test:related",
      "bun run test:related -- --base main",
      "bun run test:related -- --pr",
      "bun run test:related -- --pr --fast",
      "bun run slot -- bun run test:related",
      "cd ../flightdeck-x && bun run slot -- bun run test:related -- --keep-coverage /tmp/c",
    ]) {
      expect(worker(command) ?? `allowed: ${command}`).toContain("holds the slot");
    }
  });

  test("the refusal names the allowed forms and the override", () => {
    const why = worker("bun run test:related") ?? "";
    expect(why).toContain("bun run test:related -- --fast --tier unit,component");
    expect(why).toContain("bun --config=bunfig.area.toml test <file>");
    expect(why).toContain("bun run coverage:funcs <file> --tests <a few tests>");
    expect(why).toContain('FLIGHTDECK_SLOT_HEAVY="<reason>"');
  });

  test("--fast or --tier is allowed, and so are other scripts and quoted text", () => {
    for (const command of [
      "bun run test:related -- --fast",
      "bun run test:related -- --fast --tier unit,component",
      "bun run test:related -- --tier unit,component",
      "bun run slot -- bun run test:related -- --fast",
      "bun run typecheck",
      "git commit -m 'run bun run test:related in CI'",
    ]) {
      expect(worker(command)).toBeNull();
    }
  });

  test("coverage:funcs over more than 20 given test files is refused; 20 are allowed", () => {
    expect(worker(`bun run coverage:funcs apps/a.ts --tests ${tests(21)}`) ?? "").toContain(
      "21 test files",
    );
    expect(worker(`bun run coverage:funcs apps/a.ts --tests ${tests(20)}`)).toBeNull();
    // With no --tests, the script counts the tests that reach the file and refuses there.
    expect(worker("bun run coverage:funcs apps/a.ts")).toBeNull();
  });

  test("the coordinator passes, and so does an override that gives its reason", () => {
    expect(heavyRunViolation("bun run test:related", { FLIGHTDECK_COORDINATOR: "1" })).toBeNull();
    const override =
      'FLIGHTDECK_SLOT_HEAVY="the full gate before v0.38" bun run slot -- bun run test:related';
    expect(worker(override)).toBeNull();
    expect(heavyRunWaived(override)).toBe(true);
    expect(heavyRunWaived("bun run test:related -- --fast")).toBe(false);
  });

  test("#687: the override counts only as an env prefix of the heavy run itself, never elsewhere in the command", () => {
    for (const command of [
      'FLIGHTDECK_SLOT_HEAVY="the full gate" bun run typecheck && bun run test:related',
      "echo FLIGHTDECK_SLOT_HEAVY=a-long-enough-reason; bun run test:related",
      "bun run test:related # FLIGHTDECK_SLOT_HEAVY=a-long-enough-reason",
      'git commit -m "FLIGHTDECK_SLOT_HEAVY=a-long-enough-reason" && bun run test:related',
      "bun run test:related FLIGHTDECK_SLOT_HEAVY=a-long-enough-reason",
      // An escaped quote does not end the string: its ; is no separator.
      'git commit -m "a \\"quote\\"; FLIGHTDECK_SLOT_HEAVY=a-long-enough-reason bun run x" && bun run test:related',
      // An escaped quote outside quotes opens no string: the ; still splits.
      'FLIGHTDECK_SLOT_HEAVY=\\"reason-long; bun run test:related',
      // #687 review: each heavy run needs its own override; the first one's does not cover a second.
      'FLIGHTDECK_SLOT_HEAVY="the full gate" bun run test:related; bun run test:related',
      'bun run test:related -- --fast && FLIGHTDECK_SLOT_HEAVY="the full gate" bun run x; bun run test:related',
    ]) {
      expect(worker(command) ?? `allowed: ${command}`).toContain("holds the slot");
      expect(heavyRunWaived(command)).toBe(false);
    }
    for (const command of [
      "cd ../flightdeck-x && FLIGHTDECK_SLOT_HEAVY='the full gate' bun run slot -- bun run test:related",
      'CI=1 FLIGHTDECK_SLOT_HEAVY="every desktop test reaches the store" bun run test:related',
      'env FLIGHTDECK_SLOT_HEAVY="the full gate" bun run test:related',
      'FLIGHTDECK_SLOT_HEAVY="the full gate" bun run test:related && FLIGHTDECK_SLOT_HEAVY="every test reaches it" bun run test:related -- --pr',
    ]) {
      expect(worker(command)).toBeNull();
      expect(heavyRunWaived(command)).toBe(true);
    }
  });

  test("#687: a placeholder is no reason either (0, no, false, n, -, x)", () => {
    for (const value of ["0", "no", "false", "n", "-", "x"]) {
      const why = worker(`FLIGHTDECK_SLOT_HEAVY=${value} bun run test:related`) ?? "";
      expect(why).toContain("give the reason as the value");
    }
  });

  test("an override with no reason (1, true) is refused, and says to give the reason", () => {
    for (const value of ["1", "true", '""']) {
      const why = worker(`FLIGHTDECK_SLOT_HEAVY=${value} bun run test:related`) ?? "";
      expect(why).toContain("give the reason as the value");
    }
  });
});

describe("guard: the #687 lows", () => {
  test("other spellings of a full coverage run are refused too", () => {
    for (const command of [
      "bun test:related",
      "bun run --silent test:related",
      "bun run --bun test:related -- --pr",
      "npm run test:related",
      "bun scripts/test-related.ts",
      "bun run ./scripts/test-related.ts --base main",
      `bun scripts/coverage-funcs.ts a.ts --tests ${tests(21)}`,
    ]) {
      expect(worker(command) ?? `allowed: ${command}`).toContain("holds the slot");
    }
    for (const command of [
      "bun test:related --fast",
      "bun scripts/test-related.ts --fast --tier unit,component",
      "bun --config=bunfig.area.toml test apps/desktop/test/a.test.ts",
      "bun test apps/desktop/test/a.test.ts",
      `bun scripts/coverage-funcs.ts a.ts --tests ${tests(20)}`,
    ]) {
      expect(worker(command)).toBeNull();
    }
  });

  test("--tests with a glob, a command's output or more than 20 comma-joined files is refused", () => {
    for (const command of [
      "bun run coverage:funcs a.ts --tests 'apps/**/*.test.ts'",
      "bun run coverage:funcs a.ts --tests apps/desktop/test/*.test.ts",
      "bun run coverage:funcs a.ts --tests $(git ls-files '*.test.ts')",
      "bun run coverage:funcs a.ts --tests `git ls-files`",
      `bun run coverage:funcs a.ts --tests=${tests(21).replaceAll(" ", ",")}`,
    ]) {
      expect(worker(command) ?? `allowed: ${command}`).toContain("holds the slot");
    }
    expect(worker("bun run coverage:funcs a.ts --tests=a.test.ts,b.test.ts")).toBeNull();
    expect(worker("bun run coverage:funcs a.ts --tests 'a b.test.ts'")).toBeNull();
  });

  test("FLIGHTDECK_COORDINATOR set in the command does not make a worker the coordinator", () => {
    for (const command of [
      "FLIGHTDECK_COORDINATOR=1 bun run coverage:funcs apps/desktop/src/store.ts",
      "FLIGHTDECK_COORDINATOR=1 bun run test:related",
      "env FLIGHTDECK_COORDINATOR=1 bun run slot -- bun run test:related -- --fast",
    ]) {
      expect(worker(command) ?? "allowed").toContain("only the coordinator's own environment");
    }
    expect(worker("bun run coverage:funcs apps/desktop/src/store.ts")).toBeNull();
    // Security review: an assignment after a wrapper (`slot --`, `env`) is in the run's environment too.
    for (const command of [
      "bun run slot -- env FLIGHTDECK_COORDINATOR=1 bun run coverage:funcs apps/desktop/src/store.ts",
      "bun run slot -- FLIGHTDECK_COORDINATOR=1 bun run test:related -- --fast",
    ]) {
      expect(worker(command) ?? "allowed").toContain("only the coordinator's own environment");
    }
  });

  test("security review: every --tests occurrence counts, and flags with a value do not hide the script", () => {
    for (const command of [
      `bun run coverage:funcs a.ts --tests=a.test.ts --tests ${tests(20)}`,
      `bun run coverage:funcs a.ts --tests ${tests(11)} --tests ${tests(11)}`,
      "bun run --cwd . test:related",
      "bun --bun run test:related",
    ]) {
      expect(worker(command) ?? `allowed: ${command}`).toContain("holds the slot");
    }
    expect(worker("bun --bun run test:related -- --fast")).toBeNull();
  });

  test("#698 review: a second heavy run with an override only in front of another command is refused", () => {
    const command =
      'FLIGHTDECK_SLOT_HEAVY="the full gate" bun run test:related; FLIGHTDECK_SLOT_HEAVY="the second reason" bun run typecheck; bun run test:related -- --pr';
    expect(worker(command) ?? "allowed").toContain("holds the slot");
    expect(heavyRunWaived(command)).toBe(false);
  });

  test("#698 review: a valid first reason and a bare second override still say to give the reason", () => {
    const why =
      worker(
        'FLIGHTDECK_SLOT_HEAVY="the full gate" bun run test:related; FLIGHTDECK_SLOT_HEAVY=1 bun run test:related',
      ) ?? "";
    expect(why).toContain("give the reason as the value");
  });

  test("one guard call logs one entry: a waiver, or an allow (never both); the coordinator logs no waiver", () => {
    const heavy = 'FLIGHTDECK_SLOT_HEAVY="the full gate" bun run test:related';
    expect(guardAllowLogs(heavy, {})).toEqual([{ rule: "slot-heavy", decision: "waived" }]);
    expect(guardAllowLogs(heavy, { FLIGHTDECK_COORDINATOR: "1" })).toEqual([
      { rule: null, decision: "allow" },
    ]);
    expect(guardAllowLogs("bun run typecheck", {})).toEqual([{ rule: null, decision: "allow" }]);
    expect(guardAllowLogs(undefined, {})).toEqual([{ rule: null, decision: "allow" }]);
    const commit = 'git commit -m "fix(a): x" -m "TDD-Waiver: made in the rc merge"';
    expect(guardAllowLogs(commit, {})).toEqual([{ rule: "commit", decision: "waived" }]);
  });
});
