import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "changes what a snippet makes the host run, without the person choosing it in the app (flightdeckd snippet save, trust, use or import-history --select)";
const REASON_HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session saving, trusting or using a snippet from its shell (#3615)", () => {
  test("save, trust, use and import-history --select are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd snippet save deploy --run 'git push' --confirm", REASON],
        ["fd snippet save ask --text 'Explain' --confirm --json", REASON],
        ["fd snippet trust --project-path /srv/app --hash 0123456789abcdef --confirm", REASON],
        ["fd snippet use deploy --terminal t7 --enter --confirm", REASON],
        ["flightdeckd snippet use deploy --terminal t7 --confirm", REASON],
        ["fd snippet import-history --select abc,def --confirm", REASON],
        ["fd snippet import-history --select=abc --confirm", REASON],
        ["fd --host pi snippet use deploy --terminal t7 --confirm", REASON],
        ["fd --json --config /x/y.json snippet trust --hash 0123456789abcdef", REASON],
        ["~/.flightdeck/bin/fd snippet use deploy --terminal t7 --confirm", REASON],
        ["FLIGHTDECK_X=1 fd snippet save a --run x --confirm", REASON],
        ['fd snippet "use" deploy --terminal t7 --confirm', REASON],
        ["fd snippet us''e deploy --terminal t7 --confirm", REASON],
        ["fd snippet list --json && fd snippet use deploy --terminal t7 --confirm", REASON],
        ["bun run apps/daemon/src/bin.ts snippet use deploy --terminal t7 --confirm", REASON],
        ["bun apps/daemon/src/bin.ts snippet --host pi trust --hash 0123456789abcdef", REASON],
        ["npx flightdeckd snippet save a --run x --confirm", REASON],
        ["bash -c 'fd snippet list && fd snippet use deploy --terminal t7 --confirm'", REASON],
        ['sh -c "fd snippet import-history --select abc --confirm"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a flag the shell expands may be --select, so import-history is high then too", () => {
    expect(
      wrongReasons([
        ["S=--select; fd snippet import-history $S abc --confirm", REASON],
        ["fd snippet import-history $FLAG abc --confirm", REASON],
        ["fd snippet import-history --$NAME abc --confirm", REASON],
        ["fd snippet import-history $(printf -- --select) abc --confirm", REASON],
        ["bash -c 'S=--select; fd snippet import-history $S abc --confirm'", REASON],
        ["bunx flightdeckd snippet import-history $S abc --confirm", REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands may be save, trust or use, so the line is high too", () => {
    expect(
      wrongReasons([
        ["V=save; fd snippet $V a --run x --confirm", REASON_HIDDEN],
        ["fd snippet $'save' a --run x --confirm", REASON_HIDDEN],
        ["fd snippet sav{e,} a --run x --confirm", REASON_HIDDEN],
        ["fd snippet [s]ave a --run x --confirm", REASON_HIDDEN],
        ["bash -c 'V=use; fd snippet $V a --terminal t --confirm'", REASON_HIDDEN],
        ["echo save a --run x --confirm | xargs fd snippet", REASON_HIDDEN],
        ["fd --host pi snippet $V deploy --terminal t7 --confirm", REASON_HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads, remove and favorite stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd snippet list --json",
        "fd snippet get deploy",
        "fd snippet render deploy --value branch=dev",
        "fd snippet parse snippets.yaml",
        "fd snippet import-history --limit 20 --reveal",
        "fd snippet remove deploy --confirm",
        "fd snippet favorite deploy --off",
        "fd --host pi snippet render deploy --json",
        "fd send fd-qa 'please snippet use deploy'",
        "fd send fd-qa 'snippet trust --hash abc'",
        "echo snippet use deploy",
        "echo snippet import-history --select abc",
        "bash -c 'echo snippet trust'",
        "bash -c 'fd snippet render a && echo snippet use a'",
        "bun test snippet use",
        "fd card new 'snippet save --run x'",
      ]),
    ).toEqual([]);
    expect(bash("fd snippet render deploy").reason).toBe(MEDIUM);
  });
});
