import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "does what the app asks a person to confirm (flightdeckd history resume --force, or with a permission mode)";

describe("risk rules: a session resuming a transcript from its shell (#3461)", () => {
  test("a forced resume, or one that picks the permission mode, is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd history resume abc --force", REASON],
        ["flightdeckd history resume abc --force --json", REASON],
        ["fd history resume abc --permission-mode bypassPermissions", REASON],
        ["fd history resume abc --permission-mode=acceptEdits", REASON],
        ["fd --project p history resume abc --force", REASON],
        ["flightdeckd --config /x/y.json history resume abc --force", REASON],
        ["flightdeckd --host h1 history resume abc --permission-mode plan", REASON],
        ["bun run apps/daemon/src/bin.ts history resume abc --force", REASON],
        ['bash -c "fd history resume abc --force"', REASON],
        ["FLIGHTDECK_X=1 fd history resume abc --force", REASON],
        ["~/.flightdeck/bin/fd history resume abc --force", REASON],
        ["fd history list --json && fd history resume abc --force", REASON],
      ]),
    ).toEqual([]);
  });

  test("the other history commands and a plain resume stay ordinary shell commands", () => {
    expect(
      notHigh([
        "fd history resume abc",
        "fd history resume abc --name 'Fix login again' --json",
        "fd history list --json",
        "fd history search force",
        "fd history get abc --tail",
        "fd history tool abc m1 0",
        "fd history watch --json",
        "fd history reindex",
        "fd send s1 'run history resume abc --force'",
        "echo history resume abc --force",
        "bun test history resume --force",
        "fd card new 'history resume --permission-mode plan'",
      ]),
    ).toEqual([]);
  });
});
