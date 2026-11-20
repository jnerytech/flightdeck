import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const OPENS_REASON =
  "opens a terminal on the host, a shell that runs what is typed into it, without the person opening it in the app (flightdeckd terminal open or open-session)";
const ENABLES_REASON =
  "turns the host's terminals on, a full shell for whoever reaches the daemon, without the person choosing it in the app (flightdeckd terminal settings --enable)";

describe("risk rules: a session opening a terminal from its shell (#3538)", () => {
  test("terminal open and open-session are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd terminal open --cwd /srv", OPENS_REASON],
        ["fd terminal open --cwd /srv -- bash -l", OPENS_REASON],
        ["fd terminal open-session --session fd-qa", OPENS_REASON],
        ["flightdeckd --host pi terminal open --cwd /srv --claude --json", OPENS_REASON],
        ["fd --json --config /x/y.json terminal open-session --session s1", OPENS_REASON],
        ["FLIGHTDECK_X=1 fd terminal open --cwd /srv", OPENS_REASON],
        ['fd "terminal" open --cwd /srv', OPENS_REASON],
        ["fd termi''nal open-session --session s1", OPENS_REASON],
        ["fd terminal list && fd terminal open --cwd /srv", OPENS_REASON],
        ["bun run apps/daemon/src/bin.ts terminal open --cwd /srv", OPENS_REASON],
        ["bun apps/daemon/src/bin.ts terminal --host pi open-session --session s1", OPENS_REASON],
        ["bash -c 'fd terminal open --cwd /srv'", OPENS_REASON],
        ['sh -c "flightdeckd terminal open-session --session s1"', OPENS_REASON],
      ]),
    ).toEqual([]);
  });

  test("the list and the close stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd terminal list",
        "fd terminal list --json --host pi",
        "fd terminal close t7",
        "fd terminal close t7 --kill",
        "fd terminal settings --disable",
        "fd send fd-qa 'please terminal open'",
        "echo terminal open --cwd /srv",
        "bash -c 'echo terminal open-session'",
      ]),
    ).toEqual([]);
  });
});

describe("risk rules: a session turning the host's terminals on from its shell (#3538)", () => {
  test("terminal settings --enable is high, with or without --confirm, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd terminal settings --enable --confirm", ENABLES_REASON],
        ["fd terminal settings --enable", ENABLES_REASON],
        ["fd terminal settings --confirm --enable --json", ENABLES_REASON],
        ["flightdeckd --host pi terminal settings --enable --confirm", ENABLES_REASON],
        ["FLIGHTDECK_X=1 fd terminal settings --enable --confirm", ENABLES_REASON],
        ["bun run apps/daemon/src/bin.ts terminal settings --enable --confirm", ENABLES_REASON],
        ["bash -c 'fd terminal settings --enable --confirm'", ENABLES_REASON],
      ]),
    ).toEqual([]);
  });

  test("a bare enable word in another command is not it", () => {
    expect(
      notHigh(["fd send fd-qa 'terminal settings --enable'", "echo terminal settings --enable"]),
    ).toEqual([]);
  });
});
