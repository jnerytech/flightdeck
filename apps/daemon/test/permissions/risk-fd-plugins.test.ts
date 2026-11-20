import { describe, expect, test } from "bun:test";
import { VALUE_FLAGS } from "../../src/cli/domain/args.ts";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "brings code that runs in sessions, or takes away what the person set up (flightdeckd plugins install, update, uninstall, marketplace-add or marketplace-remove)";

describe("risk rules: a session changing the plugins from its shell (#3516)", () => {
  test("install, update, uninstall and the marketplace add and remove are high, however the CLI is reached and wherever its value flags sit", () => {
    expect(
      wrongReasons([
        ["fd plugins install a@b --confirm-hash abc", REASON],
        ["flightdeckd plugins update a@b --confirm-hash abc --accept-command def", REASON],
        ["fd plugins uninstall a@b --confirm", REASON],
        ["fd plugins marketplace-add github:acme/plugins --confirm", REASON],
        ["fd plugins marketplace-remove acme --confirm", REASON],
        ["fd --host pi plugins install --dir /x --confirm-hash abc", REASON],
        ["flightdeckd --config /x/y.json plugins uninstall a@b", REASON],
        ["fd --json plugins install a@b --confirm-hash abc", REASON],
        ["bun run apps/daemon/src/bin.ts plugins install a@b --confirm-hash abc", REASON],
        ["~/.flightdeck/bin/fd plugins uninstall a@b", REASON],
        ['fd plugins "install" a@b --confirm-hash abc', REASON],
        ["fd plugins list && fd plugins install a@b --confirm-hash abc", REASON],
        ['bash -c "fd plugins install a@b --confirm-hash abc"', REASON],
      ]),
    ).toEqual([]);
  });

  test("the reads, pin and the marketplace update stay ordinary, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd plugins list --json",
        "fd plugins detail a@b",
        "fd plugins preview a@b",
        "fd plugins preview-update a@b",
        "fd plugins pin a@b",
        "fd plugins unpin a@b",
        "fd plugins marketplace-update",
        "echo plugins install a@b",
        "bun test plugins install",
        "bash -c 'echo plugins uninstall a@b'",
      ]),
    ).toEqual([]);
    expect(bash("fd plugins list").reason).toBe(MEDIUM);
  });

  test("the new value flags are known to the rule, so they cannot hide the verb", () => {
    const flags = ["--confirm-hash", "--accept-command", "--plugin-scope"];
    for (const flag of flags) expect(VALUE_FLAGS).toContain(flag);
    expect(
      wrongReasons(flags.map((flag) => [`fd ${flag} x plugins uninstall a@b`, REASON] as const)),
    ).toEqual([]);
  });
});
