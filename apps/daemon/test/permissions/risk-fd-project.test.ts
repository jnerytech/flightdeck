import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "sets what a project runs or allows without the person confirming it in the app: its setup script, its auto-approval, or the instructions it exports to the shared store, and a drafted CLAUDE.md is a model call (flightdeckd project add, update, harness-draft or harness-export)";

describe("risk rules: a session changing a project's setup from its shell (#3515)", () => {
  test("project add, update, harness-draft and harness-export are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd project add /srv/api --setup-script 'bun install'", REASON],
        ["flightdeckd project update api --auto-approve on", REASON],
        ["fd --json project update api --setup-script none", REASON],
        ["flightdeckd --config /x/y.json project add /srv/api", REASON],
        ["fd project harness-draft /srv/api --host pi", REASON],
        ["fd project harness-export /srv/api web 'Web stack'", REASON],
        ["bun run apps/daemon/src/bin.ts project add /srv/api", REASON],
        ["FLIGHTDECK_X=1 fd project update api --name web", REASON],
        ['fd project "add" /srv/api', REASON],
        ["fd project stack /srv/api && fd project add /srv/api", REASON],
        ['bash -c "fd project update api --default-hours 4"', REASON],
        ["bunx flightdeckd project harness-draft /srv/api", REASON],
      ]),
    ).toEqual([]);
  });

  test("the read verbs and detect-provider stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd project trust-state /srv/api",
        "fd project stack /srv/api",
        "fd project trust-inspect /srv/api",
        "fd project harness-preview /srv/api --parts claudeMd",
        "fd project detect-provider api",
        "fd project --help",
        "fd card list --project add",
        "echo project add",
        "git add project",
        "ls project/update",
      ]),
    ).toEqual([]);
  });
});
