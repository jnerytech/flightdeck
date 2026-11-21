import { describe, expect, test } from "bun:test";
import { VALUE_FLAGS } from "../../src/cli/domain/args.ts";
import { OPTIONS_WITH_VALUE } from "../../src/permissions/domain/shell-call.ts";
import { VERB_NOUNS } from "../../src/permissions/domain/verb-nouns.ts";
import { bash, MEDIUM } from "../support/permissions-risk-rules.ts";

/** Each line is rated as `plain` is, and `plain` is high: the form only changes how the CLI is reached. */
function ratedAsTheDirectForm(rows: Array<[line: string, plain: string]>): string[] {
  return rows.flatMap(([line, plain]) => {
    const want = bash(plain);
    const got = bash(line);
    if (want.level !== "high") return [`${plain}: the direct form is ${want.level}, not high`];
    return got.level === want.level && got.reason === want.reason
      ? []
      : [`${line}: ${got.level} "${got.reason}", expected ${want.level} "${want.reason}"`];
  });
}

describe("risk rules: the CLI reached as `flightdeckd fd <command>` (#3566)", () => {
  test("a leading fd after flightdeckd is dropped, so every rule rates it as the plain command", () => {
    expect(
      ratedAsTheDirectForm([
        ["flightdeckd fd approve r1", "flightdeckd approve r1"],
        ["flightdeckd fd approvers enroll", "flightdeckd approvers enroll"],
        ["flightdeckd fd rules remove x --confirm", "flightdeckd rules remove x --confirm"],
        ["flightdeckd fd card discard c1 --confirm", "flightdeckd card discard c1 --confirm"],
        ["flightdeckd fd ssh hostkey confirm h", "flightdeckd ssh hostkey confirm h"],
        ["flightdeckd fd ssh remove prod --confirm", "flightdeckd ssh remove prod --confirm"],
        ["flightdeckd fd history resume s --force", "flightdeckd history resume s --force"],
        ["flightdeckd fd persona save p", "flightdeckd persona save p"],
        ["flightdeckd fd team new", "flightdeckd team new"],
        ["flightdeckd fd session close s1", "flightdeckd session close s1"],
        ["flightdeckd fd plugins install p", "flightdeckd plugins install p"],
        ["flightdeckd fd quota pause-at 90", "flightdeckd quota pause-at 90"],
        ["flightdeckd fd budget set 5", "flightdeckd budget set 5"],
      ]),
    ).toEqual([]);
  });

  test("an option can stand before or after the fd", () => {
    expect(
      ratedAsTheDirectForm([
        ["flightdeckd --host pi fd ssh hostkey confirm h", "flightdeckd ssh hostkey confirm h"],
        ["flightdeckd fd --host pi approve r1", "flightdeckd approve r1"],
        ["flightdeckd --json fd --host pi persona remove qa", "flightdeckd persona remove qa"],
      ]),
    ).toEqual([]);
  });

  test("the fd form is read through a runtime or a shell as the plain command is", () => {
    expect(
      ratedAsTheDirectForm([
        ["bun apps/daemon/src/bin.ts fd approve r1", "bun apps/daemon/src/bin.ts approve r1"],
        ["bash -c 'flightdeckd fd rules remove x'", "bash -c 'flightdeckd rules remove x'"],
        ["flightdeckd fd persona re''move qa", "flightdeckd persona remove qa"],
      ]),
    ).toEqual([]);
  });

  test("a word in an argument, a later fd or a read is no verb", () => {
    const wrong = [
      "flightdeckd fd card list --json",
      "flightdeckd fd sessions --json",
      "flightdeckd message send s1 'fd approve r1'",
      'fd message send fd-qa "fd approve"',
      "flightdeckd fd fd approve r1",
    ].flatMap((line) => {
      const got = bash(line);
      return got.level === "medium" && got.reason === MEDIUM
        ? []
        : [`${line}: ${got.level} "${got.reason}"`];
    });
    expect(wrong).toEqual([]);
  });

  test("a verb that follows a later fd is still read: only the first fd is dropped", () => {
    expect(bash("flightdeckd approve fd").level).toBe("high");
  });
});

describe("risk rules: the CLI reached without its name in the line (#3566)", () => {
  test("bun run start runs bin.ts, so its verbs are rated as the CLI's", () => {
    expect(
      ratedAsTheDirectForm([
        ["bun run start persona remove qa", "fd persona remove qa"],
        ["bun run start -- approve r1", "fd approve r1"],
        ["cd apps/daemon && bun run start ssh hostkey confirm h", "fd ssh hostkey confirm h"],
        ["bun run start fd session close s1", "fd session close s1"],
        ["bun start persona remove qa", "fd persona remove qa"],
        ["bun run --silent start approve r1", "fd approve r1"],
        ["bun run --cwd apps/daemon start persona remove qa", "fd persona remove qa"],
      ]),
    ).toEqual([]);
  });

  test("bun with options before the script (--cwd <dir> start) is rated as the CLI itself (#3718)", () => {
    expect(
      ratedAsTheDirectForm([
        ["bun --cwd apps/daemon start changes revert s a.ts", "fd changes revert s a.ts"],
        ["bun --cwd=apps/daemon start changes revert s a.ts", "fd changes revert s a.ts"],
        ["bun --cwd=apps/daemon run start mcp remove p f --confirm", "fd mcp remove p f --confirm"],
        ["bun --silent --cwd d start persona remove qa", "fd persona remove qa"],
        ["bun --bun start persona remove qa", "fd persona remove qa"],
        ["sh -c 'bun --cwd d start persona remove qa'", "fd persona remove qa"],
        ["bunx --bun --cwd d flightdeckd mcp remove p f --confirm", "fd mcp remove p f --confirm"],
        ['bun --cwd "my dir" start persona remove qa', "fd persona remove qa"],
        ["bun --cwd 'my dir' start persona remove qa", "fd persona remove qa"],
        ["bun --cwd=my\\ dir start persona remove qa", "fd persona remove qa"],
        ["bun --cwd my\\ dir start changes revert s a.ts", "fd changes revert s a.ts"],
        ["bun $OPT start persona remove qa", "fd persona remove qa"],
        ['bun "$OPT" start persona remove qa', "fd persona remove qa"],
      ]),
    ).toEqual([]);
  });

  test("a start script of another command, and a read, are ordinary shell commands", () => {
    const wrong = [
      "bun run start",
      "bun run start card list --json",
      "bun --cwd d start",
      "bun --cwd d start card list --json",
      "echo bun --cwd d start persona remove qa",
      "bun run start:web",
      "npm run start",
      "echo bun run start persona remove qa",
    ].flatMap((line) => {
      const got = bash(line);
      return got.level === "medium" && got.reason === MEDIUM
        ? []
        : [`${line}: ${got.level} "${got.reason}"`];
    });
    expect(wrong).toEqual([]);
  });

  test("a release build is the CLI by its file name", () => {
    expect(
      ratedAsTheDirectForm([
        ["./flightdeckd-linux-arm64 persona remove qa", "fd persona remove qa"],
        ["flightdeckd-windows-x64.exe approve r1", "fd approve r1"],
        ["~/Downloads/flightdeckd-linux-x64 fd rules remove x", "fd rules remove x"],
      ]),
    ).toEqual([]);
  });
});

describe("a line with many CLI starts (#3566)", () => {
  test("a runner's text of thousands of starts is rated in well under a second", () => {
    // A bound 30 times what it takes, to catch a quadratic walk (5 s on 2000 starts) and not a slow machine.
    const started = performance.now();
    const got = bash(`sh -c '${"run start ".repeat(2000)}'`);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(got.level).toBe("medium");
  });
});

describe("the option list of the shell rules (#3566)", () => {
  test("it holds exactly the options of the parser that take a value, each once", () => {
    expect([...new Set(OPTIONS_WITH_VALUE)].sort()).toEqual([...VALUE_FLAGS].sort());
    expect(OPTIONS_WITH_VALUE.filter((f, i) => OPTIONS_WITH_VALUE.indexOf(f) !== i)).toEqual([]);
  });
});

describe("the nouns whose verb the shell rules read (#3627)", () => {
  test("it holds exactly these nouns: none lost, none new, each once", () => {
    const nouns = [
      "action",
      "agentcfg",
      "approvers",
      "autoapprove",
      "automation",
      "bg",
      "boardsync",
      "budget",
      "card",
      "changes",
      "costs",
      "external",
      "file",
      "history",
      "host",
      "issues",
      "knowledge",
      "logs",
      "mcp",
      "memory",
      "message",
      "persona",
      "plugins",
      "project",
      "quota",
      "resources",
      "review",
      "rewind",
      "rules",
      "runenv",
      "session",
      "snippet",
      "ssh",
      "team",
      "telemetry",
      "watch",
      "workflow",
      "worktree",
    ];
    expect([...VERB_NOUNS].sort()).toEqual([...nouns].sort());
    expect(new Set(nouns).size).toBe(nouns.length);
  });

  test("it is kept in alphabetical order, so two PRs that add a noun do not edit the same place (#3759)", () => {
    const sorted = [...VERB_NOUNS].sort((a, b) => (a < b ? -1 : Number(a > b)));
    expect([...VERB_NOUNS]).toEqual(sorted);
  });
});
