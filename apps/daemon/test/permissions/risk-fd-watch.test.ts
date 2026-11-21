import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "changes what a card's PR watch does on its own, which sessions it wakes and what it spends, without the person choosing it in the app (flightdeckd watch set, extend, resolve-held or settings with a flag)";

describe("risk rules: a session changing a card's PR watch from its shell (#3539)", () => {
  test("watch set is high unless it only turns the watch off, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd watch set c1 --enable", REASON],
        ["fd watch set c1 --default", REASON],
        ["fd watch set c1", REASON],
        ["fd watch set c1 --disable --enable", REASON],
        ["flightdeckd --host pi watch set c1 --enable --json", REASON],
        ["FLIGHTDECK_X=1 fd watch set c1 --enable", REASON],
        ['fd "watch" set c1 --enable', REASON],
        ["fd wat''ch set c1 --enable", REASON],
        ["fd watch get c1 && fd watch set c1 --enable", REASON],
        ["bun run apps/daemon/src/bin.ts watch set c1 --enable", REASON],
        ["bash -c 'fd watch set c1 --default'", REASON],
        ["fd watch set c1 --disable=false", REASON],
      ]),
    ).toEqual([]);
  });

  test("watch extend is always high: it gives a card more rounds of Claude on the person's budget", () => {
    expect(
      wrongReasons([
        ["fd watch extend c1 --rounds 3", REASON],
        ["fd watch extend c1 --rounds=3", REASON],
        ["fd --host pi watch extend c1 --rounds 10 --json", REASON],
        ["sh -c 'flightdeckd watch extend c1 --rounds 1'", REASON],
      ]),
    ).toEqual([]);
  });

  test("watch resolve-held is high unless it only drops the round", () => {
    expect(
      wrongReasons([
        ["fd watch resolve-held c1 r1 --push", REASON],
        ["fd watch resolve-held c1 r1 --push --drop", REASON],
        ["fd watch resolve-held c1 r1", REASON],
        ["fd watch resolve-held c1 r1 --push=true", REASON],
        ["bash -c 'fd watch resolve-held c1 r1 --push'", REASON],
      ]),
    ).toEqual([]);
  });

  test("watch settings is high on any flag but --json, --host and --config, in both forms of a flag", () => {
    expect(
      wrongReasons([
        ["fd watch settings api --max-rounds 4", REASON],
        ["fd watch settings api --max-rounds=4", REASON],
        ["fd watch settings api --check 'bun test'", REASON],
        ["fd watch settings api --clear-checks", REASON],
        ["fd watch settings api --check-env JAVA_HOME", REASON],
        ["fd watch settings api --budget-usd none", REASON],
        ["fd watch settings api --enable", REASON],
        ["fd watch settings api --drift-allow 'bun.lock'", REASON],
        ["fd watch settings api --json --future-flag", REASON],
        ["fd watch settings api --host pi --persona qa", REASON],
        ["bash -c 'fd watch settings api --max-turns none'", REASON],
        ["bun apps/daemon/src/bin.ts watch settings api --daily-usd 5", REASON],
      ]),
    ).toEqual([]);
  });

  test("the reads, the turn-off, the drop and a word in an argument stay ordinary shell commands", () => {
    expect(
      notHigh([
        "fd watch get c1",
        "fd watch get c1 --json --host pi",
        "fd watch trace c1",
        "fd watch describe c1",
        "fd watch by-url https://github.com/o/r/pull/9",
        "fd watch settings api",
        "fd watch settings api --json",
        "fd watch settings api --host pi --json --config /x/y.json",
        "fd watch settings api --disable",
        "fd watch set c1 --disable",
        "fd watch set c1 --disable --json",
        "fd watch resolve-held c1 r1 --drop",
        "fd watch resolve-held c1 r1 --drop --json",
        "fd send fd-qa 'please watch extend c1 --rounds 3'",
        "echo watch set c1 --enable",
        "bash -c 'echo watch extend c1 --rounds 3'",
      ]),
    ).toEqual([]);
  });
});
