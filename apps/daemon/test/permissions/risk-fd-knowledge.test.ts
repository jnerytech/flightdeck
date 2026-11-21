import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const FEED =
  "switches whether the project's document library is given to every session it starts, a choice the app leaves to the person (flightdeckd knowledge set-feed, on or off)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session switching a project's document feed from its shell (#3623)", () => {
  test("set-feed is high on or off, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd knowledge set-feed api --on", FEED],
        ["fd knowledge set-feed api --off", FEED],
        ["fd knowledge set-feed api", FEED],
        ["flightdeckd --host pi knowledge set-feed api --on --json", FEED],
        ["FLIGHTDECK_X=1 fd knowledge set-feed api --off", FEED],
        ['fd "knowledge" set-feed api --on', FEED],
        ["fd knowledge list api && fd knowledge set-feed api --on", FEED],
        ["bun run apps/daemon/src/bin.ts knowledge set-feed api --on", FEED],
        ["bash -c 'fd knowledge set-feed api --off'", FEED],
        ["fd knowledge set-feed api $FLAG", FEED],
      ]),
    ).toEqual([]);
  });

  test("a verb or noun the shell expands is high, because the line does not say what it does", () => {
    expect(
      wrongReasons([
        ["A=set-feed; fd knowledge $A api --on", HIDDEN],
        ["fd knowledge set-fe{ed,ed} api --on", HIDDEN],
        ["bash -c 'fd knowledge $A api --on'", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads, a new document and a status change stay ordinary shell commands", () => {
    expect(
      notHigh([
        "fd knowledge list api",
        "fd knowledge index api --json",
        "fd knowledge feed api --host pi",
        "fd knowledge create api adr 'Use a queue'",
        "fd knowledge create api rfc Queue --body-file draft.md --json",
        "fd knowledge set-status api docs/adr/0001.md --status obsolete --hash abc123abc123",
        "fd message send fd-qa 'knowledge set-feed api --on'",
        "echo knowledge set-feed api --on",
      ]),
    ).toEqual([]);
  });
});
