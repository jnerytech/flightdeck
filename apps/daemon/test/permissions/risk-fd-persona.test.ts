import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "changes what the app asks a person to confirm (flightdeckd persona save, remove, reset, trust or publish-agent)";

describe("risk rules: a session saving, removing, resetting, trusting or publishing a persona from its shell (#3456)", () => {
  test("save, remove, reset, trust and publish-agent are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd persona remove qa --scope host", REASON],
        ["fd --language en persona remove qa --scope host", REASON],
        ["flightdeckd --project-path . persona publish-agent qa --confirm", REASON],
        ["flightdeckd --json --config /x/y.json persona trust local --project-path /w", REASON],
        ["fd persona save qa --scope host --name Q --description d --body b", REASON],
        ["bun run apps/daemon/src/bin.ts persona save qa --scope host --body-file x.md", REASON],
        ["fd persona reset reviewer --json", REASON],
        ["flightdeckd persona trust local --project-path /w/api", REASON],
        [
          "flightdeckd --config /x/y.json persona publish-agent qa --project-path /w --confirm",
          REASON,
        ],
        ["flightdeckd --config=/x/y.json persona remove qa --scope project", REASON],
        ["~/.flightdeck/bin/fd persona reset qa", REASON],
        ["FLIGHTDECK_X=1 fd persona remove qa --scope host", REASON],
        ['fd persona "remove" qa --scope host', REASON],
        ["fd persona re''set qa", REASON],
        ["fd persona list --json && fd persona remove qa --scope host", REASON],
        ["bun run apps/daemon/src/bin.ts persona remove qa --scope host", REASON],
        ["bunx flightdeckd persona publish-agent qa --project-path /w", REASON],
        ['bash -c "fd persona reset qa"', REASON],
        ["sh -c 'flightdeckd persona trust local --project-path /w'", REASON],
      ]),
    ).toEqual([]);
  });

  test("the other persona commands stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd persona list --json",
        "fd persona show qa",
        "fd persona subagents --project-path /w",
        "fd persona list --scope host --language en",
        "fd send fd-qa 'please remove the persona'",
        "fd card list --json",
        "echo persona remove",
        "bun test persona remove",
        "bash -c 'echo persona reset'",
      ]),
    ).toEqual([]);
    expect(bash("fd persona show qa").reason).toBe(MEDIUM);
  });
});
