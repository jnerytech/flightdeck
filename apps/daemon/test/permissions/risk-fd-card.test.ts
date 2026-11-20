import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "does what the app asks a person to confirm (flightdeckd card discard, complete, delete, merge-local or move --force)";

describe("risk rules: a session ending or forcing a card from its shell (#3454)", () => {
  test("discard, complete, delete and a forced move are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd card discard c1 --confirm", REASON],
        ["fd card complete c1 --confirm --json", REASON],
        ["flightdeckd card delete c1 --confirm", REASON],
        ["flightdeckd --config /x/y.json card discard c1 --confirm", REASON],
        ["flightdeckd --config=/x/y.json card complete c1", REASON],
        ["fd card merge-local c1 --confirm --squash", REASON],
        ["flightdeckd card merge-local c1", REASON],
        ["bun run apps/daemon/src/bin.ts card merge-local c1 --confirm", REASON],
        ["fd --project p card merge-local c1 --confirm", REASON],
        ["fd --message 'a card b' card discard c1", REASON],
        ["flightdeckd --host h1 card complete c1", REASON],
        ["fd card move c1 review --force", REASON],
        ["fd card move c1 done --position 2 --force --json", REASON],
        ["~/.flightdeck/bin/fd card discard c1 --confirm", REASON],
        ["FLIGHTDECK_X=1 fd card delete c1 --confirm", REASON],
        ['fd card "discard" c1 --confirm', REASON],
        ["fd card dis''card c1 --confirm", REASON],
        ["fd card list --json && fd card discard c1 --confirm", REASON],
        ["bun run apps/daemon/src/bin.ts card discard c1 --confirm", REASON],
        ["bunx flightdeckd card move c1 done --force", REASON],
        ['bash -c "fd card delete c1 --confirm"', REASON],
        ["sh -c 'flightdeckd card complete c1 --confirm'", REASON],
      ]),
    ).toEqual([]);
  });

  test("the other card commands stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd card list --json",
        "fd card show c1",
        "fd card new 'discard the old board'",
        "fd card start c1",
        "fd card stop c1",
        "fd card update c1 --title delete",
        "fd card move c1 review",
        "fd card move c1 review --position 2",
        "fd send fd-qa 'please discard c1'",
        // Like `fd send`, these reach a session's work by card id and are left unrated (#3454).
        "fd card message c1 'please rebase'",
        "fd card review c1",
        "fd card diff c1",
        "fd card pr-create c1 --title 'merge-local notes'",
        "fd card update-from-base c1",
        "echo card discard",
        "bun test card discard",
        "bash -c 'echo card delete'",
      ]),
    ).toEqual([]);
    expect(bash("fd card move c1 review").reason).toBe(MEDIUM);
  });
});
