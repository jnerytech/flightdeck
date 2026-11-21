import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const BYPASS =
  "allows every session on the host to run without permission prompts, a choice the app leaves to the person and its enrolled device (flightdeckd host bypass on)";
const UPDATES =
  "turns on the daemon's automatic update, which installs a new version and restarts the daemon by itself (flightdeckd host updates on)";
const ORPHAN =
  "ends a process of the host by its pid, one the session did not start (flightdeckd resources end-orphan)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: the host's switches from a session's shell (#3699)", () => {
  test("host bypass on is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd host bypass on", BYPASS],
        ["fd host bypass on --confirm", BYPASS],
        ["flightdeckd --host pi host bypass on --confirm", BYPASS],
        ["flightdeckd fd host bypass on --confirm", BYPASS],
        ["bunx flightdeckd host bypass on --confirm --json", BYPASS],
        ["bun run start host bypass on --confirm", BYPASS],
        ['bash -c "fd host bypass on --confirm"', BYPASS],
        ["fd host bypass off && fd host bypass on --confirm", BYPASS],
      ]),
    ).toEqual([]);
  });

  test("a switch word the shell expands, or none at all, could be on, so it is high", () => {
    expect(
      wrongReasons([
        ["fd host bypass $STATE", BYPASS],
        ["fd host bypass", BYPASS],
        ["fd host updates $STATE", UPDATES],
        ["fd host updates", UPDATES],
      ]),
    ).toEqual([]);
  });

  test("host updates on is high: the daemon installs a version and restarts", () => {
    expect(
      wrongReasons([
        ["fd host updates on", UPDATES],
        ["flightdeckd --host pi host updates on --json", UPDATES],
        ["flightdeckd fd host updates on", UPDATES],
        ['bash -c "fd host updates on"', UPDATES],
      ]),
    ).toEqual([]);
  });

  test("resources end-orphan is high: it ends a process by its pid", () => {
    expect(
      wrongReasons([
        ["fd resources end-orphan 4242 987654", ORPHAN],
        ["flightdeckd --host pi resources end-orphan 4242 987654 --json", ORPHAN],
        ["flightdeckd fd resources end-orphan 4242 1", ORPHAN],
        ['bash -c "fd resources end-orphan 4242 1"', ORPHAN],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be one of these, so it is high", () => {
    expect(
      wrongReasons([
        ["fd host $V on", HIDDEN],
        ["fd resources $V 4242 1", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads and the other switches stay ordinary: off directions, sleep, keep-awake, pause, pause-at", () => {
    expect(
      notHigh([
        "fd host",
        "fd host --json",
        "fd host sleep 30",
        "fd host sleep 0 --json",
        "fd host keep-awake on",
        "fd host keep-awake off",
        "fd host pause on",
        "fd host pause off --host pi",
        "fd host bypass off",
        "fd host bypass off --json --host pi",
        "fd host updates off",
        "fd resources",
        "fd resources --json",
        "fd resources pause-at 0.8",
        "fd resources pause-at off --host pi",
      ]),
    ).toEqual([]);
  });

  test("a word in an argument is no verb", () => {
    expect(
      notHigh([
        'grep "host bypass on" notes.md',
        'git commit -m "resources end-orphan 4242 1"',
        "echo host bypass on",
        "fd card list --json",
      ]),
    ).toEqual([]);
  });
});
