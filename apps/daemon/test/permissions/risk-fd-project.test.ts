import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "sets what a project runs or allows without the person confirming it in the app: its setup script, its auto-approval, or the instructions it exports to the shared store, and a drafted CLAUDE.md is a model call (flightdeckd project add, update, harness-draft or harness-export)";

const SETUP_REASON =
  "writes hooks, deny rules and instructions into a project's own files, or commits them on a new branch, which the app has the person read and confirm first; a typed --confirm is not the person (flightdeckd project harness-apply or harness-commit)";

describe("risk rules: a session changing a project's setup from its shell (#3515)", () => {
  test("project harness-apply and harness-commit are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        [
          "fd project harness-apply /srv/api --parts hooks --digests p.json --confirm",
          SETUP_REASON,
        ],
        ["flightdeckd project harness-commit /srv/api --digests a.json --confirm", SETUP_REASON],
        [
          "fd --json project harness-apply /srv/api --parts claudeMd --digests p.json",
          SETUP_REASON,
        ],
        ["bunx flightdeckd project harness-commit /srv/api --digests a.json", SETUP_REASON],
        [
          "fd project harness-preview /srv/api --parts hooks && fd project harness-apply /srv/api",
          SETUP_REASON,
        ],
        ['bash -c "fd project harness-apply /srv/api --parts hooks"', SETUP_REASON],
      ]),
    ).toEqual([]);
  });

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

const CLONE_REASON =
  "clones a repository from an address the session gave into a folder on the host, which the app has the person read and confirm first; a typed --confirm is not the person (flightdeckd project clone)";

describe("risk rules: a session cloning a repository from its shell (#3737)", () => {
  test("project clone is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd project clone https://example.com/a/b.git --root /srv/code --confirm", CLONE_REASON],
        [
          "flightdeckd --host pi project clone https://example.com/a/b.git --root /srv --confirm",
          CLONE_REASON,
        ],
        ["fd --json project clone git@example.com:a/b.git --root /srv --confirm", CLONE_REASON],
        ["bunx flightdeckd project clone https://example.com/a/b.git --root /srv", CLONE_REASON],
        ['bash -c "fd project clone https://example.com/a/b.git --root /srv"', CLONE_REASON],
        [
          "fd project scan && fd project clone https://example.com/a/b.git --root /srv",
          CLONE_REASON,
        ],
      ]),
    ).toEqual([]);
  });

  test("project scan only reads the allowed folders, so it is not high", () => {
    expect(
      notHigh(["fd project scan", "fd project scan --depth 2 --json", "flightdeckd project scan"]),
    ).toEqual([]);
  });
});
