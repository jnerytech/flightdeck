import { describe, expect, test } from "bun:test";
import { bypassArgs } from "../../src/central/domain/claude-launch-args.ts";

/** What a launch adds, for a host that allows bypass and defaults to it unless a field says otherwise. */
const added = (given: string[] = [], over: Partial<Parameters<typeof bypassArgs>[0]> = {}) =>
  bypassArgs({ allowed: true, byDefault: "bypassPermissions", given, root: false, ...over });

describe("flightdeckd claude: bypass by default (#3427)", () => {
  test("a host with the switch on and the bypass default starts claude in bypass", () => {
    expect(added()).toEqual({ args: ["--permission-mode", "bypassPermissions"], notice: null });
  });

  test("a mode the person passed wins, in both spellings, and so does a persona's", () => {
    for (const given of [
      ["--permission-mode", "plan"],
      ["--permission-mode=acceptEdits"],
      ["--dangerously-skip-permissions"],
    ]) {
      expect(added(given), given.join(" ")).toEqual({ args: [], notice: null });
    }
  });

  test("a host with the switch off, or a default that is not bypass, adds nothing", () => {
    expect(added([], { allowed: false })).toEqual({ args: [], notice: null });
    expect(added([], { byDefault: "default" })).toEqual({ args: [], notice: null });
  });

  test("under root claude refuses bypass: nothing is added and the launch says why", () => {
    const { args, notice } = added([], { root: true });
    expect(args).toEqual([]);
    expect(notice).toContain("root");
  });

  test("a persona that asks for a mode stricter than bypass keeps it; one that asks for bypass gets it", () => {
    for (const personaMode of ["plan", "default", "acceptEdits", "dontAsk"]) {
      expect(added([], { personaMode }), personaMode).toEqual({ args: [], notice: null });
    }
    expect(added([], { personaMode: "bypassPermissions" }).args).toEqual([
      "--permission-mode",
      "bypassPermissions",
    ]);
  });
});
