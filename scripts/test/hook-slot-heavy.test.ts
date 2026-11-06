import { describe, expect, test } from "bun:test";
import { heavyRunViolation, heavyRunWaived } from "../lib/claude-hooks.ts";

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
      "echo FLIGHTDECK_SLOT_HEAVY=reason; bun run test:related",
      "bun run test:related # FLIGHTDECK_SLOT_HEAVY=reason",
      'git commit -m "FLIGHTDECK_SLOT_HEAVY=reason" && bun run test:related',
      "bun run test:related FLIGHTDECK_SLOT_HEAVY=reason",
    ]) {
      expect(worker(command) ?? `allowed: ${command}`).toContain("holds the slot");
      expect(heavyRunWaived(command)).toBe(false);
    }
    for (const command of [
      "cd ../flightdeck-x && FLIGHTDECK_SLOT_HEAVY='the full gate' bun run slot -- bun run test:related",
      'CI=1 FLIGHTDECK_SLOT_HEAVY="every desktop test reaches the store" bun run test:related',
      'env FLIGHTDECK_SLOT_HEAVY="the full gate" bun run test:related',
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
