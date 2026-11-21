import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const TRUST =
  "lets a workflow's shell commands run on the host: trusting a hash is what the app asks the person for, and from a shell it is only a typed word (flightdeckd workflow trust)";
const ADD =
  "commits a workflow template on a new branch of the project and opens its PR, which the app asks the person to confirm (flightdeckd workflow template-add)";
const RESUME =
  "runs a failed workflow run's project commands again from its failed step, which the app asks the person to confirm (flightdeckd workflow resume --confirm)";
const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: the workflow verbs that write, from a session's shell (#3628)", () => {
  test("workflow trust is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd workflow trust api ship --hash abc", TRUST],
        ["flightdeckd --host pi workflow trust api ship --hash abc --json", TRUST],
        ["flightdeckd fd workflow trust api ship --hash abc", TRUST],
        ["bunx flightdeckd workflow trust api ship --hash abc", TRUST],
        ["bun run start workflow trust api ship --hash abc", TRUST],
        ['bash -c "fd workflow trust api ship --hash abc"', TRUST],
        ["fd workflow list api && fd workflow trust api ship --hash abc", TRUST],
      ]),
    ).toEqual([]);
  });

  test("workflow template-add is high with or without --confirm", () => {
    expect(
      wrongReasons([
        ["fd workflow template-add api review-loop", ADD],
        ["fd workflow template-add api review-loop --confirm", ADD],
        ["flightdeckd --host pi workflow template-add api review-loop --confirm --json", ADD],
        ["flightdeckd fd workflow template-add api review-loop --confirm", ADD],
        ['bash -c "fd workflow template-add api review-loop --confirm"', ADD],
      ]),
    ).toEqual([]);
  });

  test("workflow resume --confirm is high, and so is a resume whose flag the shell expands", () => {
    expect(
      wrongReasons([
        ["fd workflow resume r1 --confirm", RESUME],
        ["flightdeckd --host pi workflow resume r1 --confirm --json", RESUME],
        ["flightdeckd fd workflow resume --confirm r1", RESUME],
        ["bun run start workflow resume r1 --confirm", RESUME],
        ['bash -c "fd workflow resume r1 --confirm"', RESUME],
        ["fd workflow resume r1 $FLAG", RESUME],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be one of these, so it is high", () => {
    expect(wrongReasons([["fd workflow $V api ship", HIDDEN]])).toEqual([]);
  });

  test("a resume that xargs raises with a --confirm from its input is high", () => {
    expect(
      wrongReasons([
        ["echo --confirm | xargs fd workflow resume r1", HIDDEN],
        ["cat flags | xargs -n1 fd workflow resume r1", HIDDEN],
        ["echo --confirm | xargs bun run apps/daemon/src/bin.ts workflow resume r1", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads and the check form of resume stay ordinary", () => {
    expect(
      notHigh([
        "fd workflow list api",
        "fd workflow list api --json --host pi",
        "fd workflow templates api",
        "fd workflow validate api ship",
        "fd workflow run r1",
        "fd workflow watch",
        "fd workflow resume r1",
        "fd workflow resume r1 --json --host pi",
        "echo fd workflow trust api ship",
        "grep -n 'workflow trust' notes.md",
        "git commit -m 'workflow template-add docs'",
      ]),
    ).toEqual([]);
  });
});
