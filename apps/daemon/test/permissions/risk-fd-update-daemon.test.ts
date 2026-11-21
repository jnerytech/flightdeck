import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const APPLY =
  "makes this host's daemon download and install a newer build and restart, which the app asks the person to confirm and which a model's shell has no reason to start (flightdeckd update apply)";
const STOP =
  "stops this host's daemon, and with it every session and terminal it runs, which the app asks the person to confirm (flightdeckd daemon stop)";
const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: the daemon's own update and stop, from a session's shell (#3780)", () => {
  test("update apply is high with or without --confirm, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd update apply", APPLY],
        ["fd update apply --confirm", APPLY],
        ["fd update apply --confirm --json", APPLY],
        ["flightdeckd fd update apply --confirm", APPLY],
        ["bunx flightdeckd update apply --confirm", APPLY],
        ["bun run start update apply --confirm", APPLY],
        ['bash -c "fd update apply --confirm"', APPLY],
        ["fd update check && fd update apply --confirm", APPLY],
      ]),
    ).toEqual([]);
  });

  test("daemon stop is high with or without --confirm, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd daemon stop", STOP],
        ["fd daemon stop --confirm", STOP],
        ["flightdeckd daemon stop --confirm --json", STOP],
        ["flightdeckd fd daemon stop --confirm", STOP],
        ["bun run start daemon stop --confirm", STOP],
        ['bash -c "fd daemon stop --confirm"', STOP],
        ["fd update check && fd daemon stop --confirm", STOP],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be one of these, so it is high", () => {
    expect(
      wrongReasons([
        ["fd daemon $V --confirm", HIDDEN],
        ["fd update $V --confirm", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("xargs changes nothing: the verb alone is high, and a verb its input gives is hidden, so high", () => {
    expect(
      wrongReasons([
        ["echo --confirm | xargs fd update apply", APPLY],
        ["echo --confirm | xargs fd daemon stop", STOP],
        ["echo apply | xargs fd update", HIDDEN],
        ["echo stop | xargs fd daemon", HIDDEN],
        // The install of a local file with its path fed by xargs reads as unfinished, so it is high too: accepted (#3780).
        ["echo ./flightdeckd-new | xargs fd update --from", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("a leading start word is the parser's default command, so it hides no verb", () => {
    expect(
      wrongReasons([
        ["fd start update apply --confirm", APPLY],
        ["fd start daemon stop --confirm", STOP],
        ["flightdeckd start update apply --confirm", APPLY],
      ]),
    ).toEqual([]);
    expect(bash("fd start session close s1").level).toBe("high");
    expect(
      notHigh(["fd start", "flightdeckd start --config c.json", "fd start update check"]),
    ).toEqual([]);
  });

  test("update check and the install of a local file stay ordinary, and so do words that only name them", () => {
    expect(
      notHigh([
        "fd update check",
        "fd update check --json",
        "flightdeckd update check",
        "fd update --from ./flightdeckd-linux-arm64",
        "fd update --from ./flightdeckd-linux-arm64 --allow-downgrade",
        "echo fd update apply --confirm",
        "echo fd daemon stop --confirm",
        "grep -n 'update apply' notes.md",
        "git commit -m 'daemon stop docs'",
        "systemctl --user status flightdeckd",
      ]),
    ).toEqual([]);
    for (const line of ["fd update check", "fd update --from ./flightdeckd-linux-arm64"]) {
      expect(bash(line).reason).toBe(MEDIUM);
    }
  });
});
