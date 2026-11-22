import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";

const refusedWith = (argv: string[]): string => {
  try {
    parseArgs(argv);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("flightdeckd ui set: the words and flags (issue #3781)", () => {
  test("`ui set` reads the mode, the lock, the confirm and --json", () => {
    expect(
      parseArgs(["ui", "set", "--mode", "simple", "--lock", "--confirm", "--json"]),
    ).toMatchObject({
      command: "ui",
      action: "set",
      uiMode: "simple",
      uiLock: true,
      confirm: true,
      json: true,
    });
    expect(parseArgs(["ui", "set", "--unlock", "--confirm"])).toMatchObject({
      command: "ui",
      uiLock: false,
    });
    expect(parseArgs(["ui", "set", "--mode", "full", "--confirm"])).toMatchObject({
      uiMode: "full",
    });
  });

  test("it needs a verb that is `set`, and one of --mode, --lock and --unlock", () => {
    expect(refusedWith(["ui"])).toContain("invalid ui action");
    expect(refusedWith(["ui", "get"])).toContain("invalid ui action");
    expect(refusedWith(["ui", "set", "--confirm"])).toContain(
      "ui set: needs --mode, --lock or --unlock",
    );
  });

  test("--lock and --unlock together, a mode that is not full or simple, and no --confirm are refused", () => {
    expect(refusedWith(["ui", "set", "--lock", "--unlock", "--confirm"])).toContain(
      "--lock and --unlock: not both",
    );
    expect(refusedWith(["ui", "set", "--mode", "tiny", "--confirm"])).toContain(
      "--mode: full or simple",
    );
    expect(refusedWith(["ui", "set", "--mode", "simple"])).toContain("ui set: needs --confirm");
  });

  test("--lock and --unlock belong to ui set only, and --host does not apply to it", () => {
    expect(refusedWith(["sessions", "--lock"])).toContain(
      "--lock: this flag only applies to flightdeckd ui set",
    );
    expect(refusedWith(["sessions", "--unlock"])).toContain(
      "--unlock: this flag only applies to flightdeckd ui set",
    );
    expect(refusedWith(["ui", "set", "--lock", "--confirm", "--host", "pi"])).toContain("--host");
  });

  test("`file search --mode` keeps reading the file's mode", () => {
    expect(refusedWith(["file", "search", "session:s1", "--query", "x", "--mode", "content"])).toBe(
      "",
    );
  });
});
